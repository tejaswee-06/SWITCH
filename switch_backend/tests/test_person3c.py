from __future__ import annotations
import json, os, socket, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from switch_p3c.casas.inference import ActivityModel
from switch_p3c.nlu.catalog import demo_catalog
from switch_p3c.nlu.interpreter import interpret, confirm
from switch_p3c.nlu.provider import ProviderError
from switch_p3c.contracts import InterpretRequest, P3CError
from switch_p3c.repair import propose_repair
from switch_p3c.evalref import replay
from switch_p3c.api import Service


def sample_events(n=30):
 return [{"timestamp":f"2026-01-01T00:{i//60:02d}:{i%60:02d}","sensor":"M001","message":"ON" if i%2 else "OFF"} for i in range(n)]

class FakeTimeout:
 name="fake_timeout"
 def complete(self,system,user,timeout_s): raise ProviderError("provider_timeout","test timeout")
class FakeMalformed:
 name="fake_malformed"
 def complete(self,system,user,timeout_s): return "this is not json"
class FakePassClaim:
 name="fake_pass_claim"
 def complete(self,system,user,timeout_s): return '{"title":"bad","scope":{"kind":"device","id":"hallway_light"},"preconditions":[],"expected_behavior":{"device_id":"hallway_light","capability":"power","relation":"must_set","value":"off"},"ambiguities":[],"heuristic_confidence":1,"result":"PASS"}'

class Person3CTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.model=ActivityModel.load(ROOT/"switch_p3c"/"artifacts")
 def test_artifact_compatibility(self):
  self.assertTrue(self.model.ready,self.model.error)
  self.assertEqual(len(self.model.vectorizer.feature_names_),self.model.model.n_features_in_)
 def test_fresh_process_prediction(self):
  code='''import json,sys; from switch_p3c.casas.inference import ActivityModel; m=ActivityModel.load(); assert m.ready,m.error; e=json.loads(sys.stdin.read()); print(json.dumps(m.predict_window(e)))'''
  p=subprocess.run([sys.executable,"-c",code],input=json.dumps(sample_events()),text=True,capture_output=True,cwd=ROOT,timeout=60)
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertIn("activity",json.loads(p.stdout))
 def test_bad_timestamp_rejected(self):
  svc=Service(); e=sample_events(); e[3]["timestamp"]="yesterday"
  with self.assertRaises(P3CError): svc.predict({"events":e})
 def test_too_few_events_rejected(self):
  with self.assertRaises(P3CError): Service().predict({"events":sample_events(29)})
 def test_corrupt_artifact_not_ready(self):
  with tempfile.TemporaryDirectory() as td:
   Path(td,"casas_activity_context_random_forest.joblib").write_bytes(b"corrupt")
   Path(td,"casas_feature_vectorizer.joblib").write_bytes(b"corrupt")
   m=ActivityModel.load(td); self.assertFalse(m.ready); self.assertTrue(m.error)
   with self.assertRaises(P3CError): Service(artifact_dir=td).predict({"events":sample_events()})
 def test_interpreter_returns_draft_and_confirmation_gate(self):
  cat=demo_catalog("hh_test")
  d=interpret(InterpretRequest(household_id="hh_test",text="The hallway light should turn off during goodnight"),cat)
  self.assertEqual(d.status,"DRAFT")
  if not d.ambiguities:
   with self.assertRaises(P3CError): confirm(d,cat,"user",False)
 def test_provider_timeout_uses_rule_fallback(self):
  d=interpret(InterpretRequest(household_id="hh_test",text="The hallway light should turn off during goodnight"),demo_catalog("hh_test"),FakeTimeout())
  self.assertEqual(d.status,"DRAFT"); self.assertEqual(d.provenance.fallback_reason,"provider_timeout")
 def test_malformed_provider_output_uses_fallback(self):
  d=interpret(InterpretRequest(household_id="hh_test",text="The hallway light should turn off during goodnight"),demo_catalog("hh_test"),FakeMalformed())
  self.assertEqual(d.status,"DRAFT"); self.assertTrue(d.provenance.fallback_reason)
 def test_repair_validity_non_mutating(self):
  cat=demo_catalog("hh_test"); baseline={"actions":[{"device_id":"hallway_light","capability":"power","value":"on"}],"conditions":[]}
  snap=json.loads(json.dumps(baseline))
  p=propose_repair(household_id="hh_test",failed_requirement_id="req_1",routine_id="goodnight",routine_version=3,baseline_routine=baseline,trace_event_ids=["trace-1"],operations=[{"op":"change_action_value","index":0,"value":"off"}],catalog=cat)
  self.assertEqual(baseline,snap); self.assertEqual(p["status"],"NEEDS_HUMAN_REVIEW"); self.assertFalse(p["verified"]); self.assertFalse(p["deployed"])
  with self.assertRaises(P3CError): propose_repair(household_id="hh_test",failed_requirement_id="r",routine_id="goodnight",routine_version=1,baseline_routine=baseline,trace_event_ids=["t"],operations=[{"op":"change_action_value","index":0,"value":"purple"}],catalog=cat)
  with self.assertRaises(P3CError): propose_repair(household_id="hh_test",failed_requirement_id="r",routine_id="goodnight",routine_version=1,baseline_routine=baseline,trace_event_ids=["t"],operations=[{"op":"set_result","value":"PASS"}],catalog=cat)
 def test_ai_cannot_assign_pass_fail(self):
  cat=demo_catalog("hh_test")
  malicious=interpret(InterpretRequest(household_id="hh_test",text="The hallway light should turn off during goodnight"),cat,FakePassClaim())
  self.assertEqual(malicious.status,"DRAFT"); self.assertNotIn("result",malicious.model_dump())
  out=replay({"state":{"hallway_light.power":"UNKNOWN"},"assertions":[{"device_id":"hallway_light","capability":"power","expected":"off"}]})
  self.assertEqual(out["result"],"INCONCLUSIVE")
 def test_mcp_adapter_errors_and_scope(self):
  from switch_p3c.alexa import handle_jsonrpc
  bad=handle_jsonrpc({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"switch_integration_status","arguments":{"household_id":"other"}}},expected_household="hh_demo")
  self.assertIn("error",bad)
  unknown=handle_jsonrpc({"jsonrpc":"2.0","id":2,"method":"made/up"})
  self.assertEqual(unknown["error"]["code"],-32601)
 def test_all_synthetic_fixture_expectations(self):
  fixtures=json.loads((ROOT/"benchmarks"/"fixtures"/"person3c_replay_scenarios.json").read_text())
  self.assertEqual(len(fixtures),12)
  for case in fixtures:
   self.assertEqual(case["label"],"SYNTHETIC")
   self.assertEqual(replay(case)["result"],case["expected_result"],case["id"])
 def test_standin_unknown_is_inconclusive(self):
  out=replay({"state":{},"assertions":[{"device_id":"x","capability":"power","expected":"off"}]})
  self.assertEqual(out["result"],"INCONCLUSIVE")
 def test_real_http_calls(self):
  try: import uvicorn
  except ImportError: self.skipTest("uvicorn unavailable; HTTP server dependency absent")
  from switch_p3c.api import create_app
  with socket.socket() as s: s.bind(("127.0.0.1",0)); port=s.getsockname()[1]
  env=os.environ.copy(); env["PYTHONPATH"]=str(ROOT)
  logfile=tempfile.NamedTemporaryFile(delete=False)
  proc=subprocess.Popen([sys.executable,"-m","uvicorn","switch_p3c.api:create_app","--factory","--host","127.0.0.1","--port",str(port)],cwd=ROOT,env=env,stdout=logfile,stderr=logfile)
  try:
   ready=False
   for _ in range(80):
    try:
     with urlopen(f"http://127.0.0.1:{port}/api/v1/ml/health",timeout=.3) as r:
      self.assertEqual(r.status,200); ready=True; break
    except Exception: time.sleep(.15)
   self.assertTrue(ready,"server did not start: "+Path(logfile.name).read_text(errors="replace"))
   req=Request(f"http://127.0.0.1:{port}/api/v1/ml/predict-activity",data=json.dumps({"events":sample_events(29)}).encode(),headers={"Content-Type":"application/json"},method="POST")
   try: urlopen(req,timeout=3); self.fail("29-event request should fail")
   except HTTPError as e: self.assertEqual(e.code,422)
   req=Request(f"http://127.0.0.1:{port}/mcp",data=json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}).encode(),headers={"Content-Type":"application/json"},method="POST")
   with urlopen(req,timeout=3) as r:
    body=json.loads(r.read()); self.assertEqual(body["result"]["_meta"]["liveAlexaPlus"],"BLOCKED")
  finally:
   proc.terminate()
   try: proc.wait(timeout=5)
   except subprocess.TimeoutExpired: proc.kill()
   logfile.close()
   Path(logfile.name).unlink(missing_ok=True)

if __name__=="__main__": unittest.main(verbosity=2)
