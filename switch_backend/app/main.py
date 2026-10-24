"""FastAPI entry point. Thin layer: auth, validation, error format, routing."""
import logging, os
from typing import Any, Literal, Optional
from fastapi import Body, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel, ConfigDict, ValidationError
from .errors import ApiError
from .schemas import Routine
from .seed import seed, h
from .services import Services, need
from .store import Store
from .validation import validate_routine
from .catalog import CATALOG

log = logging.getLogger("switch")


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_correction: str
    structured: Optional[dict[str, Any]] = None
    routine_ids: list[str] = []
    scenario_ids: list[str] = []
    # "rule_based_fallback" (default, original single regex) | "p3c" (Person 3C interpreter on the canonical catalog)
    interpreter: Literal["rule_based_fallback", "p3c"] = "rule_based_fallback"
    context: Optional[dict[str, Any]] = None
    answers: Optional[dict[str, Any]] = None


class InterpretIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    context: Optional[dict[str, Any]] = None
    answers: Optional[dict[str, Any]] = None


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: Optional[Literal["regression", "journey"]] = None


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int


class PatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int
    content: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    note: Optional[str] = None


class CandidateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    routine: dict[str, Any]


class ReplayIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str
    requirement_ids: Optional[list[str]] = None
    compare_to_run_id: Optional[str] = None
    extra_scenario_ids: Optional[list[str]] = None      # edge-case scenarios -> kind "exploratory" (never used for approval)
    via: Literal["web_ui", "alexa_simulated", "api"] = "api"


class SuggestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repair_ops: Optional[list[dict[str, Any]]] = None
    proposal_source: Optional[str] = None               # e.g. "p3c_llm"; p3c* sources are also checked by the P3C validator


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"] = "approve"
    note: Optional[str] = None


def _errs(e: ValidationError):
    return [{"code": "SCHEMA", "path": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in e.errors()]


def create_app(db_path: str = ":memory:", auto_seed: bool = True, profile: Optional[str] = None) -> FastAPI:
    st = Store(db_path)
    svc = Services(st)
    profile = profile or os.getenv("SWITCH_DEMO_PROFILE", "regression")
    app = FastAPI(title="SWITCH Person B backend (SIMULATED DEMO)", version="1.0.0")
    app.state.store, app.state.svc = st, svc
    origins = [o for o in os.getenv("SWITCH_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:3000").split(",") if o]
    # Any port on this machine's loopback address is allowed (e.g. Vite moving to :5174 when :5173 is busy).
    # Override with SWITCH_CORS_ORIGIN_REGEX (empty string disables it) for stricter deployments.
    loopback = os.getenv("SWITCH_CORS_ORIGIN_REGEX", r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$") or None
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=loopback, allow_methods=["*"], allow_headers=["*"])
    demo = os.getenv("SWITCH_ENV", "demo") == "demo"
    if demo:
        log.warning("SWITCH_ENV=demo: static DEMO-ONLY tokens are active and /demo/reset is enabled. Not for production.")
    if auto_seed and demo and not st.one("SELECT 1 FROM households"):
        seed(st, profile)
    app.state.profile = profile

    def err(status, code, msg, details=None):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": msg, "details": details or []}})

    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError): return err(e.status, e.code, e.message, e.details)

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        return err(422, "VALIDATION_ERROR", "request body or parameters are invalid",
                   [{"code": "SCHEMA", "path": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in e.errors()])

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(e.status_code, "HTTP_ERROR")
        return err(e.status_code, code, str(e.detail))

    @app.exception_handler(Exception)
    async def _any(_: Request, e: Exception):
        log.exception("unhandled error")           # details stay server-side
        return err(500, "INTERNAL_ERROR", "unexpected server error")

    def principal(authorization: Optional[str] = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise ApiError(401, "UNAUTHENTICATED", "missing bearer token")
        u = st.one("SELECT user_id, household_id, role FROM users WHERE token_hash=?", (h(authorization[7:].strip()),))
        if not u:
            raise ApiError(401, "UNAUTHENTICATED", "invalid token")
        return u

    P = Depends(principal)

    @app.get("/")
    def root():
        return {"service": "SWITCH backend (SIMULATED DEMO)", "status": "running", "health": "/health", "api_docs": "/docs",
                "app": "Open the SWITCH app at http://127.0.0.1:5173 (this address is the API only)."}

    @app.get("/health")
    def health():
        from . import p3c_bridge as PB
        from .simulator import SIMULATOR_VERSION
        from .catalog import CONTRACT_LOADED
        ist = PB.interpreter_status()
        return {"status": "ok", "environment": "SIMULATED DEMO" if demo else "UNSPECIFIED", "persistence": "sqlite",
                "ai_interpreter": "llm provider configured" if ist["llm_configured"] else "not_configured (rule-based interpreters only)",
                "interpreter": ist, "device_control": "none", "simulator_version": SIMULATOR_VERSION,
                "seed_profile": app.state.profile, "canonical_contract_loaded": CONTRACT_LOADED,
                "alexa_plus": {"route": "C", "integration_mode": "simulated_demo", "connection_status": "not_configured", "label": "SIMULATED DEMO"}}

    @app.post("/demo/reset")
    def reset(b: Optional[ResetIn] = None, p=P):
        if not demo:
            raise ApiError(404, "NOT_FOUND", "not available")
        need(p, "owner")
        if p["household_id"] != "hh_demo":
            raise ApiError(403, "FORBIDDEN", "demo reset is limited to the demo household owner")
        if b and b.profile:
            app.state.profile = b.profile
        info = seed(st, app.state.profile)             # wipes ONLY the demo households
        return {**info, "message": "demo state reset"}

    @app.get("/catalog")
    def catalog(p=P): return CATALOG

    @app.post("/routines/validate")
    def validate(body: dict[str, Any], p=P):
        try:
            r = Routine.model_validate(body)
        except ValidationError as e:
            return {"valid": False, "issues": _errs(e)}
        issues = validate_routine(r)
        return {"valid": not issues, "issues": issues}

    @app.get("/routines")
    def routines(p=P):
        import json
        return [json.loads(r["json"]) for r in st.all(
            "SELECT json FROM routines r WHERE household_id=? AND version=(SELECT MAX(version) FROM routines WHERE household_id=r.household_id AND routine_id=r.routine_id) ORDER BY routine_id", (p["household_id"],))]

    @app.get("/scenarios")
    def scenarios(p=P):
        return svc.list_scenarios(p)

    @app.get("/routines/{routine_id}/diff")
    def routine_diff(routine_id: str, to: int, p=P, frm: int = Query(1, alias="from")):
        return svc.routine_diff(p, routine_id, frm, to)

    @app.post("/routines/candidates", status_code=201)
    def create_routine_candidate(b: CandidateIn, p=P):
        """Spec route name (master spec section 13); same behaviour as POST /candidates."""
        return create_cand(b, p)

    @app.get("/catalog/contract")
    def catalog_contract(p=P):
        from .catalog import load_contract
        return load_contract()

    # requirements
    @app.post("/requirements/interpret")
    def interpret(b: InterpretIn, p=P): return svc.interpret(p, b.model_dump())

    @app.post("/requirements/drafts", status_code=201)
    def draft(b: DraftIn, p=P): return svc.create_draft(p, b.model_dump())

    @app.post("/requirements/{rid}/confirm")
    def confirm(rid: str, b: ConfirmIn, p=P): return svc.confirm(p, rid, b.version)

    @app.get("/requirements")
    def list_req(status: Optional[str] = None, device: Optional[str] = None, routine_id: Optional[str] = None,
                 last_result: Optional[str] = None, p=P): return svc.list_requirements(p, status, device, routine_id, last_result)

    @app.get("/requirements/{rid}")
    def get_req(rid: str, p=P): return svc.get_requirement(p, rid)

    @app.get("/requirements/{rid}/versions")
    def req_versions(rid: str, p=P): return svc.requirement_versions(p, rid)

    @app.patch("/requirements/{rid}")
    def patch_req(rid: str, b: PatchIn, p=P): return svc.patch_requirement(p, rid, b.model_dump())

    # candidates
    @app.post("/candidates", status_code=201)
    def create_cand(b: CandidateIn, p=P):
        try:
            r = Routine.model_validate(b.routine)
        except ValidationError as e:
            raise ApiError(422, "ROUTINE_INVALID", "routine is malformed", _errs(e))
        return svc.create_candidate(p, r)

    @app.get("/candidates")
    def list_cand(p=P): return svc.list_candidates(p)

    @app.get("/candidates/{cid}")
    def get_cand(cid: str, p=P): return svc.get_candidate(p, cid)

    @app.get("/candidates/{cid}/diff")
    def cand_diff(cid: str, p=P): return svc.candidate_diff(p, cid)

    @app.post("/candidates/{cid}/suggest-fix", status_code=201)
    def suggest(cid: str, b: SuggestIn, p=P): return svc.suggest_fix(p, cid, b.repair_ops, b.proposal_source)

    @app.post("/candidates/{cid}/approve")
    def approve(cid: str, b: DecisionIn, p=P): return svc.decide(p, cid, b.decision, b.note)

    @app.post("/candidates/{cid}/review")
    def review(cid: str, b: DecisionIn, p=P):
        """Spec route name (master spec section 13); same rules as /approve. Recording a decision never deploys."""
        return svc.decide(p, cid, b.decision, b.note)

    # replays
    @app.post("/replays", status_code=201)
    def replay(b: ReplayIn, p=P): return svc.replay(p, b.candidate_id, b.requirement_ids, b.compare_to_run_id, b.extra_scenario_ids, b.via)

    @app.get("/replays")
    def list_replays(candidate_id: Optional[str] = None, p=P): return svc.list_replays(p, candidate_id)

    @app.get("/replays/{run_id}")
    def get_replay(run_id: str, p=P): return svc.get_replay(p, run_id)

    @app.get("/replays/{run_id}/verify")
    def verify(run_id: str, p=P): return svc.verify_reproducible(p, run_id)

    @app.get("/replays/{run_id}/report")
    def report(run_id: str, p=P): return svc.report(p, run_id)

    # Person 3C integration. These routes share Person 2 authentication and household scope.
    # Interpretation and repair output are proposals only; Person 2 remains the sole evaluator.
    try:
        from switch_p3c.nlu.catalog import demo_catalog as p3c_demo_catalog
        from switch_p3c.nlu.interpreter import interpret as p3c_interpret
        from switch_p3c.contracts import InterpretRequest as P3CInterpretRequest, P3CError
        from switch_p3c.repair import propose_repair as p3c_propose_repair
        from switch_p3c.alexa import handle_jsonrpc as p3c_handle_jsonrpc, LIVE_STATUS as P3C_LIVE_STATUS
        from switch_p3c.config import ARTIFACT_DIR as P3C_ARTIFACT_DIR
        from switch_p3c.casas.inference import ActivityModel as P3CActivityModel
        p3c_model = P3CActivityModel.load(P3C_ARTIFACT_DIR)
    except Exception as import_error:
        log.exception("Person 3C integration could not initialize")
        p3c_demo_catalog = p3c_interpret = P3CInterpretRequest = P3CError = None
        p3c_propose_repair = p3c_handle_jsonrpc = None
        P3C_LIVE_STATUS = {"status": "BLOCKED", "reason": "adapter unavailable"}
        p3c_model = None
        p3c_import_error = type(import_error).__name__
    else:
        p3c_import_error = None

    @app.get("/person3c/status")
    def person3c_status(p=P):
        return {"status": "IMPLEMENTED" if p3c_interpret else "BLOCKED", "household_id": p["household_id"],
                "interpreter": "deterministic fallback; optional LLM not verified",
                "repair_proposals": "available" if p3c_propose_repair else "unavailable",
                "ml_ready": bool(p3c_model and p3c_model.ready),
                "ml_error": (p3c_model.error if p3c_model and not p3c_model.ready else p3c_import_error),
                "alexa": {"mode": "SIMULATED DEMO", "live_status": P3C_LIVE_STATUS},
                "evaluator_authority": "Person 2 deterministic backend only"}

    from . import p3c_bridge as PB
    from .alexa_adapter import AlexaSimulatedAdapter
    alexa = AlexaSimulatedAdapter(svc)
    app.state.alexa = alexa

    @app.post("/person3c/interpret")
    def person3c_interpret(body: dict[str, Any], p=P):
        """Raw Person 3C draft (P3C schema) on the CANONICAL catalog. For the canonical proposal use /requirements/interpret."""
        if not p3c_interpret:
            raise ApiError(503, "PERSON3C_UNAVAILABLE", "Person 3C interpreter could not initialize")
        payload = dict(body)
        payload["household_id"] = p["household_id"]
        try:
            req = P3CInterpretRequest(**payload)
            result = p3c_interpret(req, PB.interpretation_catalog(p["household_id"], svc._latest_routines(p["household_id"])), PB.llm_provider())
            return result.model_dump(mode="json")
        except P3CError as e:
            raise ApiError(e.http_status, e.code, e.message, e.details)
        except Exception as e:
            log.exception("Person 3C interpretation failed")
            raise ApiError(422, "INTERPRETATION_INVALID", "correction could not be interpreted safely", [{"type": type(e).__name__}])

    @app.post("/person3c/repair/propose")
    def person3c_repair(body: dict[str, Any], p=P):
        if not p3c_propose_repair:
            raise ApiError(503, "PERSON3C_UNAVAILABLE", "Person 3C repair service could not initialize")
        payload = dict(body)
        payload["household_id"] = p["household_id"]
        if "candidate_id" in payload:          # canonical preview mode: validate the deterministic proposal, create nothing
            return svc.preview_repair(p, payload["candidate_id"])
        try:
            return p3c_propose_repair(**payload, catalog=PB.repair_catalog(p["household_id"], svc._latest_routines(p["household_id"])))
        except P3CError as e:
            raise ApiError(e.http_status, e.code, e.message, e.details)
        except Exception as e:
            log.exception("Person 3C repair proposal failed")
            raise ApiError(422, "REPAIR_INVALID", "repair proposal rejected", [{"type": type(e).__name__}])

    @app.get("/person3c/alexa/status")
    def person3c_alexa_status(p=P):
        return {"mode": "SIMULATED DEMO", "status": "SIMULATED", "live": P3C_LIVE_STATUS,
                "household_id": p["household_id"], "route": "local MCP-style JSON-RPC; not live Alexa+"}

    @app.post("/person3c/mcp")
    def person3c_mcp(body: Any = Body(...), p=P):
        """Backward-compatible path for Person 3C's MCP-style endpoint. It now uses the canonical Route C adapter, so tool
        calls reach the real SWITCH services (Person 3C's standalone reference evaluator is not used in the product)."""
        return alexa.handle(p, body)

    # ---------------- Alexa+ (Route C: integrated SIMULATED experience; see docs/ALEXA_PLUS_INTEGRATION.md)
    @app.get("/integrations/alexa/status")
    def alexa_status(p=P): return alexa.status(p)

    @app.post("/integrations/alexa/test")
    def alexa_test(p=P): return alexa.health_check(p)

    @app.post("/integrations/alexa/mcp")
    def alexa_mcp(body: Any = Body(...), p=P): return alexa.handle(p, body)

    return app


app = create_app(os.getenv("SWITCH_DB", "data/switch.db")) if os.getenv("SWITCH_DB") or os.getenv("SWITCH_AUTORUN") else None
