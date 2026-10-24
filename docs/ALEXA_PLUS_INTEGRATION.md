# Alexa+ integration — route decision, implementation and evidence

**Status: SIMULATED (Route C).** SWITCH is **not** connected to Amazon, Alexa+, an Amazon account or any device.
The UI never shows `ALEXA+ CONNECTED`; the badge is `SIMULATED DEMO` and the backend reports
`connection_status: not_configured`.

## 1. Route decision

| Route | What it needs (checked against Amazon's docs, 23 Oct 2026) | Available here? | Decision |
|---|---|---|---|
| **A — live MCP server for Alexa+** | MCP server reachable at a **remote HTTPS URL**; **Streamable HTTP** transport; **MCP spec 2025-11-25**; **OAuth 2.1 authorization-code flow with PKCE (S256)**, RFC 9728 protected-resource metadata, `/.well-known/oauth-authorization-server`; round-trip latency **< 500 ms**; an **Alexa developer account** and the `alexa-ai` CLI (`alexa-ai configure` / `deploy`) to register the add-on and test it in the web simulator or on a device. | No developer/preview access, no OAuth client, no public endpoint, no Amazon account. | **BLOCKED** |
| **B — Alexa+ Agent Skill** | A documented Agent Skill route plus the same developer access and a way to invoke it. | Not available / not verifiable. | **BLOCKED** |
| **C — integrated simulated Alexa+ experience** | In-app experience wired to the real SWITCH APIs and deterministic simulator; source included; clearly labelled. | Yes. | **SELECTED (primary route)** |

Sources: [Alexa+ MCP toolkit quickstart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html),
[Alexa+ MCP toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html).
Amazon's pages do not state preview eligibility; requirements can change, so re-check before attempting Route A.

## 2. What was built (Route C)

```
Browser: Alexa+ panel (src/ui/AlexaPanel.jsx)            <- SIMULATED assistant: typed text + a small deterministic router
   │  JSON-RPC 2.0 (initialize, tools/list, tools/call, ping)   modelled on MCP; protocolVersion "2025-11-25"
   ▼
Backend: POST /integrations/alexa/mcp  (switch_backend/app/alexa_adapter.py)
   │  every tool calls the REAL SWITCH services with the authenticated household principal
   ▼
Person 2 services (same SQLite DB, versioning, simulator, evaluator, approvals) + Person 3C interpreter/validator
```

* **Simulated:** the assistant itself (no voice capture, no Alexa NLU — `routeUtterance()` in `AlexaPanel.jsx` is a
  visible, deterministic router), the transport (plain HTTP POST to the local API, not Streamable HTTP sessions/SSE),
  and authentication (the backend's DEMO-ONLY bearer token, not OAuth 2.1).
* **Real:** every answer is the structured result of a tool call to the SWITCH backend. Drafts, confirmations,
  replays, repair candidates and decisions created through Alexa+ are the same records the web UI shows; the store
  re-syncs after each mutating call, so the 3D house, timeline and reports update.
* **No parallel state store.** Person 3C's earlier standalone MCP-style handler (`switch_p3c/alexa`, which used a
  reference stand-in evaluator) is kept for its own unit tests only; the integrated `POST /person3c/mcp` path now routes
  to the canonical adapter.

### Tool contract (master spec §12)

| Tool | Behaviour | Safety |
|---|---|---|
| `switch_integration_status` | route, mode, connection status, live blockers | read-only |
| `switch_create_correction_draft` | Person 3C interpretation → saved DRAFT if unambiguous, else clarification (nothing saved) | never confirms |
| `switch_get_requirement` | requirement (+ optional version history) | household-scoped |
| `switch_confirm_requirement` | confirm a DRAFT | requires `explicit_user_confirmation: true` and owner role; records actor/time/version |
| `switch_list_routines` | routines + candidates with provenance `local_fixture` | read-only |
| `switch_preview_routine_change` | candidate diff + affected requirements | no live change |
| `switch_run_replay` | deterministic suite; run id, versions, counts, evidence ids, correlation id | simulated replay, never device execution |
| `switch_get_replay_report` | assertions, failure evidence, reviewer decisions | trace-backed |
| `switch_propose_repair` | constrained, UNVERIFIED repair candidate | never applied to a live routine |
| `switch_record_review_decision` | approve / reject | requires `explicit_user_confirmation: true`; approval refused unless the latest full run of that candidate is PASS and not stale; never deploys |

Input schemas are closed (`additionalProperties: false`); unknown fields, wrong types and missing confirmation flags
are rejected with `isError: true` (`INVALID_ARGUMENTS`). Unknown tools return JSON-RPC `-32602`; malformed requests
`-32600`; unknown methods `-32601`. Replays started through the adapter are recorded with
`integration.invoked_via = "alexa_simulated"`, the adapter version and a safe correlation id, and appear in Reports.

### Endpoints

| Route | Purpose |
|---|---|
| `GET /integrations/alexa/status` | `integration_mode: simulated_demo`, `connection_status: not_configured`, `source_provenance: local_fixture`, capabilities, last health check, consent model, live blockers |
| `POST /integrations/alexa/test` | harmless in-process self-test (initialize, tools/list, status call); records `last_health_check`; contacts no Amazon endpoint; no device control |
| `POST /integrations/alexa/mcp` | JSON-RPC tools above |
| `POST /person3c/mcp` | backward-compatible alias of the same adapter (also accepts Person 3C's earlier `switch_interpret_correction` name) |

## 3. Evidence

* `switch_backend/tests/test_final_integration.py`: `test_alexa_status_is_simulated_and_never_connected`,
  `test_alexa_jsonrpc_protocol_and_errors`, `test_alexa_tools_drive_the_real_workflow_and_enforce_human_gates`,
  `test_household_scoping_on_new_routes` — all pass (see `FINAL_SUBMISSION_STATUS.md` for the run).
* Browser E2E (`tools/e2e_journey.mjs`): Devices/Integrations shows `SIMULATED DEMO`, the connection test passes while the
  status stays `not_configured`; in the Alexa+ drawer the user proposes a fix, reruns, approves with an explicit "yes",
  and the web UI's Replay Lab reflects the decision recorded through the adapter.

## 4. Privacy and permissions

Nothing leaves the machine: no Amazon call, no third-party model call. Correction text is stored as the requirement's
`source_correction`. Consent for turning a correction into a durable requirement is the explicit confirmation step
(required by the adapter and the API). Secrets: none are needed for Route C; the demo token is a public DEMO-ONLY fixture.

## 5. What it would take to go live (Route A)

1. Obtain Alexa developer access for Alexa+ add-ons; install the `alexa-ai` CLI.
2. Wrap `alexa_adapter.AlexaSimulatedAdapter` behind a real MCP server library with **Streamable HTTP** at a public
   **HTTPS** URL (the tool handlers can be reused unchanged; they are transport-independent).
3. Implement **OAuth 2.1 + PKCE (S256)** with RFC 9728 metadata and map the OAuth subject to a SWITCH household
   principal (replacing the demo token); never accept tokens in query strings.
4. Meet the < 500 ms latency target, add listing assets, deploy with `alexa-ai deploy`, test in the web simulator,
   and only then switch the UI badge to `ALEXA+ CONNECTED` with the exact verified scope.

## Release 2 update: in-app assistant

- The in-app assistant (`src/ui/AlexaPanel.jsx`, `src/assistant/`) now covers the whole journey in natural language and
  renders typed result cards instead of tool output.
- The adapter gained a read-only `switch_list_requirements` tool. Every tool now returns spoken text (`say`), so
  `content[0].text` is never serialized JSON.
- The route is unchanged: **Route C, SIMULATED DEMO**. No Amazon endpoint, account, voice capture or device is involved.
