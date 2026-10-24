# SWITCH Person 3C — ML / AI / API README

## Status snapshot

This package preserves the existing CASAS pipeline and correction interpreter and adds repair proposals, a replay reference stand-in, a simulated MCP-style adapter, HTTP API registrars, tests, and handoff documentation.

| Feature | Status | Evidence / boundary |
|---|---|---|
| CASAS model pipeline and artifacts | IMPLEMENTED (artifact-dependent) | Existing files in `switch_p3c/casas/` and `switch_p3c/artifacts/`; tests check load and fresh-process inference. Existing STATUS.md metrics are synthetic and are **not real CASAS accuracy**. |
| Correction interpretation | IMPLEMENTED (rule-based fallback) | `switch_p3c/nlu/`; provider is optional and unverified live. |
| Repair proposal generation | IMPLEMENTED | `switch_p3c/repair/`; allowlisted operations, catalog validation, immutable baseline copy, `verified=false`, `NEEDS_HUMAN_REVIEW`. |
| Replay stand-in | SIMULATED | `switch_p3c/evalref/`; explicitly NOT Person 2's evaluator. Unknown/missing state gives `INCONCLUSIVE`. |
| Person 2 client | PROPOSED contract | Routes are assumptions only, documented in integration contract; not asserted to exist. |
| Alexa+ adapter | SIMULATED | MCP-style JSON-RPC over local `POST /mcp`; no live Alexa+ request is made. |
| Live Alexa+ | BLOCKED | Requires access, remote URL, Streamable HTTP, MCP 2025-11-25, OAuth 2.1 + PKCE and developer account verification. |
| HTTP API | IMPLEMENTED when FastAPI or Starlette available | `switch_p3c/api/`; framework-neutral route table is `ROUTE_TABLE`. |

## Run locally

From this directory (`person3c/`):

```bash
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt  # pins match the saved artifact metadata
python -m unittest discover -s tests -v
uvicorn switch_p3c.api:create_app --factory --host 127.0.0.1 --port 8000
```

If dependencies cannot be installed, run the standard-library tests that can execute in the current environment. The service selects FastAPI first and Starlette as a fallback; Uvicorn is needed to run the server command.

## HTTP routes

The canonical route inventory is `switch_p3c.api.ROUTE_TABLE`. It includes health/readiness/model info/metrics, 30-event prediction, batch prediction, event processing, interpretation, clarification, explicit confirmation, repair proposals, simulated Alexa status/test, `/mcp`, and the replay stand-in.

Prediction accepts exactly 30 events. Each event must include ISO-8601 `timestamp`, `sensor`, and `message`. Missing/corrupt model artifacts make the service not-ready; inference never fabricates a prediction.

## Important model boundary

The activity classifier predicts annotated activity context only. It does not identify routine conflicts, user corrections, or repair success. Do not cite synthetic metrics as real-world accuracy. Real CASAS evaluation requires the real labelled dataset and a home-held-out split.
