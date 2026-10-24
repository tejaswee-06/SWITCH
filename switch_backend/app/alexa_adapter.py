"""Alexa+ integration - Route C: SIMULATED in-app Alexa+ experience (MCP-style JSON-RPC tools).

Route decision (see docs/ALEXA_PLUS_INTEGRATION.md): no Alexa+ developer/preview access, OAuth client, public
HTTPS endpoint or Amazon account was available, so a live MCP server (Route A) or Agent Skill (Route B) could not be
verified. This module is the source-included simulated route the master spec allows. It is NOT connected to Amazon.

What it does: it exposes the tool contract from the master spec (section 12) as JSON-RPC 2.0 methods modelled on MCP
(initialize, tools/list, tools/call, ping). Every tool calls the real Person 2 SWITCH services with the authenticated
household principal - the same database, versioning, deterministic simulator and evaluator the web UI uses. There is
no parallel state store, and no tool can execute a device command or deploy a routine.

Not implemented here: Streamable HTTP sessions/SSE, OAuth 2.1 + PKCE, a public URL, and any Amazon-side invocation.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Callable

from .errors import ApiError
from .services import ALEXA_ADAPTER_VERSION, Services
from .store import now

PROTOCOL_VERSION = "2025-11-25"
MODE = "SIMULATED DEMO"
LIVE_BLOCKERS = [
    "No Alexa+ developer / preview access verified for this team",
    "No OAuth 2.1 + PKCE client configured (required for a live MCP connection)",
    "No public HTTPS endpoint hosting a Streamable HTTP MCP server",
    "No Amazon account linking or live device / routine source",
]

_S = lambda props, req=(): {"type": "object", "properties": props, "required": list(req), "additionalProperties": False}
TOOLS: list[dict] = [
    {"name": "switch_integration_status", "description": "Report the integration mode (SIMULATED DEMO), connection status and live blockers. Read-only.",
     "inputSchema": _S({})},
    {"name": "switch_create_correction_draft", "description": "Interpret a household correction and, if unambiguous, save it as a DRAFT requirement. Never confirms.",
     "inputSchema": _S({"text": {"type": "string", "minLength": 1, "maxLength": 600}, "context": {"type": "object"}}, ["text"])},
    {"name": "switch_get_requirement", "description": "Read one requirement (and optionally its version history). Household-scoped.",
     "inputSchema": _S({"requirement_id": {"type": "string"}, "include_history": {"type": "boolean"}}, ["requirement_id"])},
    {"name": "switch_confirm_requirement", "description": "Confirm a reviewed DRAFT. Requires explicit_user_confirmation=true; records actor, time and version.",
     "inputSchema": _S({"requirement_id": {"type": "string"}, "version": {"type": "integer", "minimum": 1},
                        "explicit_user_confirmation": {"type": "boolean", "const": True}}, ["requirement_id", "version", "explicit_user_confirmation"])},
    {"name": "switch_list_routines", "description": "List the household's normalized routines and pending candidate versions with provenance.",
     "inputSchema": _S({})},
    {"name": "switch_preview_routine_change", "description": "Return a candidate's diff against its baseline and the requirements it affects. No live change.",
     "inputSchema": _S({"candidate_id": {"type": "string"}}, ["candidate_id"])},
    {"name": "switch_run_replay", "description": "Run the deterministic regression suite for a candidate. Returns run ID, versions, counts and evidence references.",
     "inputSchema": _S({"candidate_id": {"type": "string"}, "extra_scenario_ids": {"type": "array", "items": {"type": "string"}}}, ["candidate_id"])},
    {"name": "switch_get_replay_report", "description": "Retrieve a replay report: assertions, failure evidence and reviewer decisions. Trace-backed.",
     "inputSchema": _S({"run_id": {"type": "string"}}, ["run_id"])},
    {"name": "switch_propose_repair", "description": "Create a constrained, UNVERIFIED repair candidate for a failing candidate. Not applied to any live routine.",
     "inputSchema": _S({"candidate_id": {"type": "string"}}, ["candidate_id"])},
    {"name": "switch_record_review_decision", "description": "Record a human approve/reject decision. Requires explicit_user_confirmation=true. Never deploys.",
     "inputSchema": _S({"candidate_id": {"type": "string"}, "decision": {"type": "string", "enum": ["approve", "reject"]},
                        "note": {"type": "string", "maxLength": 300}, "explicit_user_confirmation": {"type": "boolean", "const": True}},
                       ["candidate_id", "decision", "explicit_user_confirmation"])},
    {"name": "switch_list_requirements", "description": "List the household's saved requirements (title, version, status, last result). Read-only.",
     "inputSchema": _S({"status": {"type": "string", "enum": ["DRAFT", "CONFIRMED", "DISABLED"]}})},
]
TOOL_NAMES = [t["name"] for t in TOOLS]
LEGACY_ALIASES = {"switch_interpret_correction": "switch_create_correction_draft"}   # Person 3C's earlier tool name


def _check_args(tool: dict, args: Any) -> list[str]:
    """Minimal JSON-schema check for the flat schemas above (unknown fields, required, types, const, enum)."""
    if not isinstance(args, dict):
        return ["arguments must be an object"]
    schema, errs = tool["inputSchema"], []
    for k in args:
        if k not in schema["properties"]:
            errs.append(f"unknown field '{k}'")
    for k in schema["required"]:
        if k not in args:
            errs.append(f"missing required field '{k}'")
    types = {"string": str, "integer": int, "boolean": bool, "array": list, "object": dict}
    for k, spec in schema["properties"].items():
        if k not in args:
            continue
        v = args[k]
        t = types[spec["type"]]
        if not isinstance(v, t) or (t is int and isinstance(v, bool)):
            errs.append(f"'{k}' must be {spec['type']}"); continue
        if "const" in spec and v != spec["const"]:
            errs.append(f"'{k}' must be {spec['const']!r}")
        if "enum" in spec and v not in spec["enum"]:
            errs.append(f"'{k}' must be one of {spec['enum']}")
        if spec["type"] == "string" and len(v) < spec.get("minLength", 0):
            errs.append(f"'{k}' must not be empty")
        if spec["type"] == "string" and len(v) > spec.get("maxLength", 10**6):
            errs.append(f"'{k}' is too long")
    return errs


class AlexaSimulatedAdapter:
    def __init__(self, svc: Services):
        self.svc = svc
        self.last_health_check: dict | None = None

    # ------------------------------------------------------------------ status / health
    def status(self, p: dict) -> dict:
        return {"route": "C", "route_name": "Integrated simulated Alexa+ experience (in-app)", "label": MODE,
                "integration_mode": "simulated_demo", "connection_status": "not_configured",
                "source_provenance": "local_fixture", "adapter_version": ALEXA_ADAPTER_VERSION, "protocol_model": f"MCP-style JSON-RPC 2.0 (protocolVersion {PROTOCOL_VERSION})",
                "transport": "HTTP POST to this SWITCH API (not Streamable HTTP; not reachable by Amazon)",
                "household_id": p["household_id"], "capabilities": TOOL_NAMES,
                "capabilities_verified_by_last_check": (self.last_health_check or {}).get("tools_listed", []),
                "last_health_check": self.last_health_check,
                "user_consent": {"model": "explicit per-requirement confirmation (switch_confirm_requirement requires explicit_user_confirmation=true)",
                                 "durable_requirement_requires_confirmation": True},
                "live": {"status": "BLOCKED", "blockers": LIVE_BLOCKERS},
                "data_sent_externally": "none - no call leaves this machine",
                "limitations": ["Not connected to Amazon or Alexa+; responses are produced by SWITCH, not by Alexa",
                                "No device control, no routine import from Amazon, no deployment",
                                "Voice is not captured; the in-app assistant accepts typed text"]}

    def health_check(self, p: dict) -> dict:
        """Harmless self-test of the adapter: initialize, tools/list and a read-only status call. No device control."""
        checks, ok = [], True
        init = self.handle(p, {"jsonrpc": "2.0", "id": "hc-1", "method": "initialize", "params": {"protocolVersion": PROTOCOL_VERSION}})
        c1 = "result" in init and init["result"].get("protocolVersion") == PROTOCOL_VERSION
        checks.append({"check": "initialize", "ok": c1}); ok &= c1
        lst = self.handle(p, {"jsonrpc": "2.0", "id": "hc-2", "method": "tools/list"})
        names = [t["name"] for t in lst.get("result", {}).get("tools", [])]
        c2 = names == TOOL_NAMES
        checks.append({"check": "tools/list", "ok": c2, "count": len(names)}); ok &= c2
        st = self.handle(p, {"jsonrpc": "2.0", "id": "hc-3", "method": "tools/call", "params": {"name": "switch_integration_status", "arguments": {}}})
        c3 = st.get("result", {}).get("isError") is False
        checks.append({"check": "tools/call switch_integration_status", "ok": c3}); ok &= c3
        self.last_health_check = {"at": now(), "ok": ok, "scope": "in-process simulated adapter only (no Amazon endpoint contacted)",
                                  "checks": checks, "tools_listed": names}
        self.svc.st.audit(p["household_id"], p["user_id"], "alexa_sim_health_check", "integration", "alexa_plus_sim", {"ok": ok})
        return {"ok": ok, "connection_status": "not_configured", "integration_mode": "simulated_demo", "label": MODE, **self.last_health_check}

    # ------------------------------------------------------------------ tools (each calls the real SWITCH services)
    def _tool(self, p: dict, name: str, a: dict) -> dict:
        svc, hh = self.svc, p["household_id"]
        base = {"mode": MODE, "household_id": hh}
        if name == "switch_integration_status":
            return {**base, "action_kind": "READ_ONLY_STATUS", "status": self.status(p),
                    "say": "I am a simulated Alexa+ experience running inside SWITCH. I am not connected to Amazon, to an Alexa account or to any physical device; "
                           "every answer comes from the local SWITCH backend and its deterministic simulator."}
        if name == "switch_list_requirements":
            reqs = svc.list_requirements(p, status=a.get("status"))
            rows = [{"requirement_id": r["requirement_id"], "version": r["version"], "status": r["status"], "title": r["title"],
                     "routine_ids": r["scope"]["routine_ids"], "last_result": r.get("last_result")} for r in reqs]
            n_conf = sum(1 for r in rows if r["status"] == "CONFIRMED")
            return {**base, "action_kind": "READ_ONLY", "requirements": rows,
                    "say": f"This household has {len(rows)} saved requirement{'s' if len(rows) != 1 else ''} ({n_conf} confirmed)."}
        if name == "switch_create_correction_draft":
            proposal = svc.interpret(p, {"text": a["text"], "context": a.get("context")})
            if not proposal["can_create_draft"]:
                return {**base, "action_kind": "CLARIFICATION_NEEDED_NOTHING_SAVED", "proposal": proposal,
                        "say": "I need a bit more detail before I can save that: " + "; ".join(q["question"] for q in proposal["questions"][:2])}
            draft = svc.create_draft(p, {"source_correction": a["text"], "structured": proposal["structured"]})
            return {**base, "action_kind": "DRAFT_SAVED_NOT_CONFIRMED", "draft": draft, "proposal": proposal,
                    "say": f"I drafted: \"{draft['title']}\". It is not active yet. Should I save it as a household rule?"}
        if name == "switch_get_requirement":
            req = svc.get_requirement(p, a["requirement_id"])
            out = {**base, "action_kind": "READ_ONLY", "requirement": req, "say": f"{req['requirement_id']} v{req['version']} is {req['status']}: {req['title']}."}
            if a.get("include_history"):
                out["history"] = svc.requirement_versions(p, a["requirement_id"])
            return out
        if name == "switch_confirm_requirement":
            r = svc.confirm(p, a["requirement_id"], a["version"])
            return {**base, "action_kind": "REQUIREMENT_CONFIRMED", "requirement": r,
                    "say": f"Saved {r['requirement_id']} as version {r['version']}. It will be checked whenever a related routine changes."}
        if name == "switch_list_routines":
            import json as _j
            rows = svc.st.all("SELECT json FROM routines r WHERE household_id=? AND version=(SELECT MAX(version) FROM routines WHERE household_id=r.household_id AND routine_id=r.routine_id) ORDER BY routine_id", (hh,))
            cands = []
            for c in svc.list_candidates(p):
                row = {k: c[k] for k in ("candidate_id", "routine_id", "version", "base_version", "status", "description", "parent_candidate_id")}
                last = svc.st.one("SELECT run_id, overall FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, c["candidate_id"]))
                row["last_full_run"] = {"run_id": last["run_id"], "overall": last["overall"]} if last else None
                cands.append(row)
            routines = [_j.loads(x["json"]) for x in rows]
            pending = [c for c in cands if c["status"] == "PENDING_REVIEW"]
            return {**base, "action_kind": "READ_ONLY", "source_provenance": "local_fixture", "routines": routines, "candidates": cands,
                    "say": f"{len(routines)} routine{'s' if len(routines) != 1 else ''} and {len(pending)} candidate change{'s' if len(pending) != 1 else ''} waiting for review."}
        if name == "switch_preview_routine_change":
            d = svc.candidate_diff(p, a["candidate_id"])
            reqs = svc.list_requirements(p, status="CONFIRMED")
            cand = svc.get_candidate(p, a["candidate_id"])
            touched = {x["device"] for x in cand["routine"]["actions"]}
            affected = [{"requirement_id": r["requirement_id"], "version": r["version"], "title": r["title"]} for r in reqs
                        if cand["routine_id"] in r["scope"]["routine_ids"] or r["expected_behavior"]["device"] in touched]
            return {**base, "action_kind": "PREVIEW_NO_LIVE_CHANGE", "diff": d["changes"], "candidate": {"candidate_id": cand["candidate_id"], "version": cand["version"],
                    "status": cand["status"], "description": cand["description"], "routine_id": cand["routine_id"], "base_version": cand["base_version"]},
                    "affected_requirements": affected, "before": d["baseline"], "after": d["candidate"],
                    "say": "; ".join(c["summary"] for c in d["changes"] if c["path"] != "version") or "No functional change."}
        if name == "switch_run_replay":
            corr = f"alexa-sim-{uuid.uuid4().hex[:8]}"
            run = svc.replay(p, a["candidate_id"], None, None, a.get("extra_scenario_ids"), "alexa_simulated", corr)
            fails = [t for t in run["suite"]["tests"] if t["status"] != "PASS"]
            return {**base, "action_kind": "SIMULATED_REPLAY_NOT_DEVICE_EXECUTION", "run_id": run["run_id"], "kind": run["kind"],
                    "overall": run["suite"]["overall"], "totals": run["suite"]["totals"], "simulator_version": run["simulator_version"],
                    "requirement_versions": run["requirement_versions"], "scenario_versions": run["scenario_versions"],
                    "candidate": run["candidate"], "correlation_id": corr,
                    "findings": [{"status": t["status"], "requirement_id": t["requirement_id"], "scenario_id": t["scenario_id"],
                                  "reason": t["reason"], "evidence_event_ids": t["evidence_event_ids"]} for t in fails],
                    "say": (f"The check {run['suite']['overall']}ED." if run['suite']['overall'] in ('PASS', 'FAIL') else f"The check is {run['suite']['overall']}.")
                           + (f" {fails[0]['reason']}." if fails else " All selected requirements passed in the modeled scenarios.")}
        if name == "switch_get_replay_report":
            rep = svc.report(p, a["run_id"])
            details = []
            for f in rep["failure_evidence"]:
                try:
                    req = svc.get_requirement(p, f["requirement_id"])
                    title, expected = req["title"], req.get("expected_behavior")
                except ApiError:
                    title, expected = f["requirement_id"], None
                details.append({**f, "requirement_title": title, "expected_behavior": expected})
            first = details[0] if details else None
            say = (f"In run {rep['run_id']} the requirement \"{first['requirement_title']}\" failed in scenario {first['scenario_id']}: {first['reason']}."
                   if first else f"Run {rep['run_id']} has no failed assertions (overall {rep['suite']['overall']}).")
            return {**base, "action_kind": "READ_ONLY", "run_id": rep["run_id"], "overall": rep["suite"]["overall"], "totals": rep["suite"]["totals"],
                    "candidate": rep["candidate"], "candidate_status": rep["candidate_status"],
                    "summary": rep["summary"], "failure_evidence": rep["failure_evidence"], "failure_details": details,
                    "reviewer_decisions": rep["reviewer_decisions"], "safety_statement": rep["safety_statement"], "say": say}
        if name == "switch_propose_repair":
            fix = svc.suggest_fix(p, a["candidate_id"], None)
            parent_routine = svc.get_candidate(p, a["candidate_id"])["routine"]
            new_routine = svc.get_candidate(p, fix["candidate_id"])["routine"]
            return {**base, "action_kind": "UNVERIFIED_CANDIDATE_CREATED_NOT_APPLIED", "candidate_id": fix["candidate_id"], "version": fix["version"],
                    "repair_ops": fix["repair_ops"], "diff_vs_parent": fix.get("routine_diff_vs_parent"), "provenance": fix["repair_provenance"],
                    "parent_candidate_id": a["candidate_id"], "before": parent_routine, "after": new_routine,
                    "verified": False, "say": "I proposed a fix. It is not verified yet; I need to re-run the checks before you can approve it."}
        if name == "switch_record_review_decision":
            d = svc.decide(p, a["candidate_id"], a["decision"], a.get("note"))
            return {**base, "action_kind": "HUMAN_DECISION_RECORDED_NOT_DEPLOYED", "decision": d,
                    "say": f"Recorded: {d['status'].lower()}. Nothing was deployed to any device."}
        raise ApiError(404, "UNKNOWN_TOOL", f"tool '{name}' not found")

    # ------------------------------------------------------------------ JSON-RPC 2.0
    def handle(self, p: dict, body: Any) -> dict:
        if not isinstance(body, dict):
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
        ident = body.get("id")
        if body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
            return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32600, "message": "Invalid Request"}}
        m, params = body["method"], body.get("params") or {}
        if m == "initialize":
            return {"jsonrpc": "2.0", "id": ident, "result": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "switch-alexa-plus-simulated", "version": ALEXA_ADAPTER_VERSION},
                    "instructions": "SIMULATED DEMO. SWITCH tools for corrections, requirements, deterministic replays and human review. No device control.",
                    "_meta": {"mode": MODE, "liveAlexaPlus": "BLOCKED"}}}
        if m in ("notifications/initialized", "ping"):
            return {"jsonrpc": "2.0", "id": ident, "result": {}}
        if m == "tools/list":
            return {"jsonrpc": "2.0", "id": ident, "result": {"tools": TOOLS, "_meta": {"mode": MODE}}}
        if m == "tools/call":
            name = LEGACY_ALIASES.get(params.get("name"), params.get("name"))
            tool = next((t for t in TOOLS if t["name"] == name), None)
            if tool is None:
                return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32602, "message": f"Unknown tool: {params.get('name')}"}}
            args = dict(params.get("arguments") or {})
            if params.get("name") == "switch_interpret_correction":
                args.pop("household_id", None)      # legacy P3C tool carried household_id; scope now comes from auth
            errs = _check_args(tool, args)
            if errs:
                return self._tool_error(ident, "INVALID_ARGUMENTS", "tool arguments failed schema validation", [{"message": e} for e in errs])
            try:
                result = self._tool(p, name, args)
            except ApiError as e:
                return self._tool_error(ident, e.code, e.message, e.details)
            return {"jsonrpc": "2.0", "id": ident, "result": {"content": [{"type": "text", "text": result.get("say") or "Done."}],
                                                              "structuredContent": result, "isError": False}}
        return {"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "Method not found"}}

    @staticmethod
    def _tool_error(ident, code, message, details) -> dict:
        err = {"error": {"code": code, "message": message, "details": details or []}, "mode": MODE}
        return {"jsonrpc": "2.0", "id": ident, "result": {"content": [{"type": "text", "text": f"{code}: {message}"}],
                                                          "structuredContent": err, "isError": True}}
