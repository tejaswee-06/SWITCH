"""Framework-neutral route table plus FastAPI and Starlette registrars."""
from __future__ import annotations
import json, datetime
from pathlib import Path
from typing import Any
from .. import config
from ..contracts import P3CError, InterpretRequest
from ..casas.inference import ActivityModel
from ..nlu.catalog import demo_catalog
from ..nlu.interpreter import interpret, apply_clarification, confirm
from ..nlu.provider import OpenAICompatibleProvider
from ..repair import propose_repair
from ..evalref import replay, Person2Client
from ..alexa import handle_jsonrpc, LIVE_STATUS

ROUTE_TABLE=[
 {"method":"GET","path":"/api/v1/ml/health","purpose":"liveness"},
 {"method":"GET","path":"/api/v1/ml/ready","purpose":"artifact readiness"},
 {"method":"GET","path":"/api/v1/ml/model-info","purpose":"model metadata"},
 {"method":"GET","path":"/api/v1/ml/metrics","purpose":"saved evaluation metrics"},
 {"method":"POST","path":"/api/v1/ml/predict-activity","purpose":"exactly 30 event activity-context prediction"},
 {"method":"POST","path":"/api/v1/ml/predict-activity/batch","purpose":"batch of exact 30-event windows"},
 {"method":"POST","path":"/api/v1/ml/process-events","purpose":"same strict 30-event inference contract"},
 {"method":"POST","path":"/api/v1/interpret","purpose":"create DRAFT correction interpretation"},
 {"method":"POST","path":"/api/v1/clarify","purpose":"apply clarification; remains DRAFT"},
 {"method":"POST","path":"/api/v1/confirm","purpose":"explicit user confirmation gate"},
 {"method":"POST","path":"/api/v1/repair/propose","purpose":"validated repair proposal, never deployment"},
 {"method":"GET","path":"/api/v1/alexa/status","purpose":"SIMULATED DEMO status; live route BLOCKED"},
 {"method":"POST","path":"/api/v1/alexa/test","purpose":"local MCP-style JSON-RPC adapter test"},
 {"method":"POST","path":"/mcp","purpose":"SIMULATED DEMO MCP-style JSON-RPC over POST"},
 {"method":"POST","path":"/api/v1/evalref/replay","purpose":"reference stand-in; NOT Person 2 evaluator"},
]

class Service:
 def __init__(self, artifact_dir=None, catalog_factory=demo_catalog, provider=None):
  self.artifact_dir=Path(artifact_dir or config.ARTIFACT_DIR); self.catalog_factory=catalog_factory; self.provider=provider
  self.model=ActivityModel.load(self.artifact_dir)
 def refresh_model(self): self.model=ActivityModel.load(self.artifact_dir); return self.model
 def health(self): return {"status":"ok","service":"switch-person3c"}
 def ready(self): return {"ready":bool(self.model.ready),"status":"ready" if self.model.ready else "not_ready","error":self.model.error or None}
 def model_info(self): return {"ready":bool(self.model.ready),"model_type":type(self.model.model).__name__ if self.model.ready else None,"window_events":self.model.window_events,"artifact_dir":str(self.artifact_dir),"classes":[str(x) for x in getattr(self.model.model,"classes_",[])] if self.model.ready else [],"error":self.model.error or None,"data_source":self.model.metadata.get("data_source")}
 def metrics(self):
  p=self.artifact_dir/config.METRICS_FILE
  if not p.is_file(): return {"available":False,"reason":"metrics file missing"}
  try: return {"available":True,"metrics":json.loads(p.read_text())}
  except Exception as e: return {"available":False,"reason":"metrics file corrupt","error":type(e).__name__}
 def predict(self, payload):
  if not self.model.ready: raise P3CError("MODEL_NOT_READY","model artifacts missing or corrupt",{"error":self.model.error},503)
  events=payload.get("events")
  if not isinstance(events,list) or len(events)!=30: raise P3CError("INVALID_WINDOW","exactly 30 events required",{"received":len(events) if isinstance(events,list) else None,"required":30},422)
  for i,e in enumerate(events):
   if not isinstance(e,dict) or not all(k in e for k in ("timestamp","sensor","message")): raise P3CError("INVALID_EVENT","each event needs timestamp, sensor, message",{"index":i},422)
   try:
    dt=datetime.datetime.fromisoformat(str(e["timestamp"]).replace("Z","+00:00"))
    if dt.tzinfo is None: pass
   except (ValueError,TypeError): raise P3CError("INVALID_TIMESTAMP","timestamp must be ISO-8601",{"index":i,"value":e.get("timestamp")},422)
  try: return self.model.predict_window(events)
  except ValueError as e: raise P3CError("INVALID_WINDOW",str(e),{},422)
 def interpret(self,p):
  req=InterpretRequest(**p); return interpret(req,self.catalog_factory(req.household_id),self.provider).model_dump(mode="json")
 def clarify(self,p):
  hid=p.get("household_id"); draft=p.get("draft")
  if not isinstance(draft,dict): raise P3CError("INVALID_INPUT","draft object required",{},422)
  from ..contracts import RequirementDraft
  d=RequirementDraft(**draft); return apply_clarification(d,p.get("answers",{}),self.catalog_factory(hid)).model_dump(mode="json")
 def confirm(self,p):
  from ..contracts import RequirementDraft
  d=RequirementDraft(**p["draft"]); out=confirm(d,self.catalog_factory(d.household_id),p.get("confirmed_by",""),p.get("explicit_user_confirmation") is True)
  return out.model_dump(mode="json")
 def repair(self,p):
  return propose_repair(household_id=p["household_id"],failed_requirement_id=p["failed_requirement_id"],routine_id=p["routine_id"],routine_version=p["routine_version"],baseline_routine=p["baseline_routine"],trace_event_ids=p.get("trace_event_ids",[]),operations=p.get("operations",[]),catalog=self.catalog_factory(p["household_id"]))
 def alexa_status(self): return {"mode":"SIMULATED DEMO","status":"SIMULATED","live":LIVE_STATUS,"route":"MCP-style JSON-RPC over local POST /mcp; not a live Alexa+ integration"}
 def mcp(self,p): return handle_jsonrpc(p,expected_household=config.HOUSEHOLD_ID,provider=self.provider)

def _dispatch(service, method, path, payload=None):
 try:
  if method=="GET":
   return {"/api/v1/ml/health":service.health,"/api/v1/ml/ready":service.ready,"/api/v1/ml/model-info":service.model_info,"/api/v1/ml/metrics":service.metrics,"/api/v1/alexa/status":service.alexa_status}.get(path,lambda:{"error":"not found"})(),200
  p=payload or {}
  if path in ("/api/v1/ml/predict-activity","/api/v1/ml/process-events"): return service.predict(p),200
  if path=="/api/v1/ml/predict-activity/batch":
   windows=p.get("windows")
   if not isinstance(windows,list): raise P3CError("INVALID_INPUT","windows array required",{},422)
   return {"predictions":[service.predict({"events":w.get("events") if isinstance(w,dict) else w}) for w in windows]},200
  if path=="/api/v1/interpret": return service.interpret(p),200
  if path=="/api/v1/clarify": return service.clarify(p),200
  if path=="/api/v1/confirm": return service.confirm(p),200
  if path=="/api/v1/repair/propose": return service.repair(p),200
  if path in ("/mcp","/api/v1/alexa/test"): return service.mcp(p),200
  if path=="/api/v1/evalref/replay": return replay(p),200
  return {"error":{"code":"NOT_FOUND","message":"route not found"}},404
 except P3CError as e: return e.to_dict(),e.http_status
 except (KeyError,TypeError,ValueError) as e: return {"error":{"code":"INVALID_INPUT","message":str(e)[:200],"details":{}}},422

def create_fastapi_app(service=None):
 try:
  from fastapi import FastAPI, Request
  from fastapi.responses import JSONResponse
 except ImportError: raise RuntimeError("FastAPI not installed; use create_starlette_app")
 svc=service or Service(); app=FastAPI(title="SWITCH Person 3C API",version="0.1.0",description="ML/AI integration; Alexa+ is SIMULATED DEMO")
 app.state.p3c_service=svc
 async def dispatch(request: Request):
  try: payload=await request.json() if request.method!="GET" else None
  except Exception: return JSONResponse({"error":{"code":"INVALID_JSON","message":"request body must be JSON"}},status_code=400)
  data,status=_dispatch(svc,request.method,request.url.path,payload)
  return JSONResponse(data,status_code=status)
 dispatch.__annotations__["request"] = Request  # Request is imported locally; resolve annotation for FastAPI.
 for r in ROUTE_TABLE:
  app.add_api_route(r["path"],dispatch,methods=[r["method"]],name=(r["method"]+"_"+r["path"].replace("/","_").strip("_")))
 return app

def create_starlette_app(service=None):
 try: from starlette.applications import Starlette
 except ImportError: raise RuntimeError("Neither FastAPI nor Starlette is installed")
 from starlette.requests import Request
 from starlette.responses import JSONResponse
 from starlette.routing import Route
 svc=service or Service()
 async def dispatch(request: Request):
  try: payload=await request.json() if request.method!="GET" else None
  except Exception: return JSONResponse({"error":{"code":"INVALID_JSON","message":"request body must be JSON"}},status_code=400)
  data,status=_dispatch(svc,request.method,request.url.path,payload)
  return JSONResponse(data,status_code=status)
 dispatch.__annotations__["request"] = Request
 return Starlette(debug=False,routes=[Route(r["path"],dispatch,methods=[r["method"]]) for r in ROUTE_TABLE])

def create_app(service=None):
 try: return create_fastapi_app(service)
 except RuntimeError as e:
  if "FastAPI not installed" not in str(e): raise
  return create_starlette_app(service)
