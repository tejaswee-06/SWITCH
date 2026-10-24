"""SIMULATED DEMO MCP-style JSON-RPC adapter. Not a live Alexa+ integration."""
from __future__ import annotations
from typing import Any
from .. import config
from ..contracts import P3CError
from ..nlu.catalog import demo_catalog
from ..nlu.interpreter import interpret
from ..contracts import InterpretRequest
from ..evalref import replay

MODE="SIMULATED DEMO"
LIVE_STATUS={"status":"BLOCKED","reason":"Live Alexa+ requires verified access, Streamable HTTP, MCP 2025-11-25, OAuth 2.1 + PKCE, a remote URL, and a developer account. None is claimed as configured here."}
TOOLS=[
 {"name":"switch_interpret_correction","description":"Create a DRAFT correction interpretation; never confirms or executes it.","inputSchema":{"type":"object","properties":{"household_id":{"type":"string"},"text":{"type":"string","minLength":1}},"required":["household_id","text"],"additionalProperties":False}},
 {"name":"switch_replay_preview","description":"Run the local reference stand-in on supplied synthetic scenario data; NOT Person 2 evaluator.","inputSchema":{"type":"object","properties":{"household_id":{"type":"string"},"scenario":{"type":"object"}},"required":["household_id","scenario"],"additionalProperties":False}},
 {"name":"switch_integration_status","description":"Report integration mode and live Alexa+ blocker.","inputSchema":{"type":"object","properties":{"household_id":{"type":"string"}},"required":["household_id"],"additionalProperties":False}}
]

def call_tool(name: str, args: dict, *, expected_household: str | None=None, provider=None) -> dict:
    hid=args.get("household_id")
    if not hid or (expected_household and hid != expected_household):
        raise P3CError("HOUSEHOLD_SCOPE_ERROR", "household scope missing or not authorized", {"requested":hid}, 403)
    if name=="switch_interpret_correction":
        cat=demo_catalog(hid)
        draft=interpret(InterpretRequest(household_id=hid,text=args["text"]),cat,provider=provider)
        return {"mode":MODE,"action_kind":"PROPOSED_DRAFT_NOT_EXECUTED","draft":draft.model_dump(mode="json")}
    if name=="switch_replay_preview":
        out=replay(args["scenario"])
        return {"mode":MODE,"action_kind":"SIMULATED_REPLAY_NOT_DEVICE_EXECUTION","household_id":hid,"replay":out}
    if name=="switch_integration_status":
        return {"mode":MODE,"action_kind":"READ_ONLY_STATUS","household_id":hid,"live_alexa_plus":LIVE_STATUS}
    raise P3CError("UNKNOWN_TOOL", "tool not found", {"tool":name}, 404)

def handle_jsonrpc(body: dict, *, expected_household: str | None=None, provider=None) -> dict:
    if not isinstance(body,dict): return {"jsonrpc":"2.0","id":None,"error":{"code":-32600,"message":"Invalid Request"}}
    ident=body.get("id")
    if body.get("jsonrpc")!="2.0" or not isinstance(body.get("method"),str):
        return {"jsonrpc":"2.0","id":ident,"error":{"code":-32600,"message":"Invalid Request"}}
    method=body["method"]; params=body.get("params") or {}
    if method=="initialize":
        return {"jsonrpc":"2.0","id":ident,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":False}},"serverInfo":{"name":"switch-p3c-simulated-demo","version":"0.1.0"},"_meta":{"mode":MODE,"liveAlexaPlus":"BLOCKED"}}}
    if method=="notifications/initialized": return {"jsonrpc":"2.0","id":ident,"result":{}}
    if method=="tools/list": return {"jsonrpc":"2.0","id":ident,"result":{"tools":TOOLS,"_meta":{"mode":MODE}}}
    if method=="tools/call":
        name=params.get("name"); args=params.get("arguments") or {}
        try:
            result=call_tool(name,args,expected_household=expected_household,provider=provider)
            return {"jsonrpc":"2.0","id":ident,"result":{"content":[{"type":"text","text":__import__('json').dumps(result)}],"structuredContent":result,"isError":False}}
        except P3CError as e:
            return {"jsonrpc":"2.0","id":ident,"error":{"code":-32000,"message":e.message,"data":{"code":e.code,"details":e.details,"http_status":e.http_status}}}
        except (KeyError,TypeError,ValueError) as e:
            return {"jsonrpc":"2.0","id":ident,"error":{"code":-32602,"message":"Invalid params","data":{"reason":type(e).__name__}}}
    return {"jsonrpc":"2.0","id":ident,"error":{"code":-32601,"message":"Method not found"}}
