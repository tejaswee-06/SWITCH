> **Note (final integration):** the Person 2 / Person 3C contracts described here have been reconciled. The frozen shared contract (canonical room/device ids, translation tables, routes) is **[docs/CONTRACTS.md](../../docs/CONTRACTS.md)**; overall status is **[FINAL_SUBMISSION_STATUS.md](../../FINAL_SUBMISSION_STATUS.md)**. Text below is the original document, kept for history.

# Person 3C Integration Contract — PROPOSED until Person 2 confirms

## Authority and status semantics

- AI may interpret, clarify, explain and propose. It must not assign an authoritative replay result.
- Only Person 2's deterministic evaluator owns `PASS`, `FAIL`, `INCONCLUSIVE` in the integrated system.
- Unknown state, missing evidence, unsupported capability, or incomplete trace must not become `PASS`.
- Corrections remain `DRAFT` until explicit user confirmation. Repair proposals are not deployed or approved automatically.
- The included `evalref.replay` is a small **SIMULATED reference stand-in**, explicitly **NOT Person 2's evaluator**.

## Proposed routes (not verified against Person 2)

| Purpose | Proposed route | Method |
|---|---|---|
| Request deterministic replay | `/api/v1/replay` | POST |
| List/retrieve requirements | `/api/v1/requirements` | GET |
| List/retrieve routines | `/api/v1/routines` | GET |

Configure `SWITCH_CORE_API_URL`, optional `SWITCH_CORE_API_TOKEN`, and `SWITCH_CORE_API_TIMEOUT_S`. `Person2Client` sends JSON with optional bearer auth and surfaces timeouts/network/HTTP errors. Person 2 must publish and confirm real paths, schemas, authentication, error shape, and version semantics before these routes are treated as implemented.

## Proposed request and evidence fields

Use the canonical fields actually found in Person 2's implementation when available. Until then, the following are proposed names, not assertions about the live backend:

- Household: `household_id`.
- Routine: `routine_id`, `routine_version`.
- Requirement: `requirement_id`, version, status (`DRAFT` / `CONFIRMED` etc.).
- Repair proposal: `failed_requirement_id`, `routine_id`, `routine_version`, `trace_event_ids`, machine-readable `diff`, `status=NEEDS_HUMAN_REVIEW`, `verified=false`.
- Trace event evidence: stable event IDs and recorded expected/actual state. Do not invent IDs if none are supplied.
- Result enum: `PASS`, `FAIL`, `INCONCLUSIVE`, assigned only by deterministic evaluator.

## Repair operation allowlist

Only `add_condition`, `modify_condition`, `remove_action`, and `change_action_value` are accepted. Every device/capability/value is checked against the local catalog. The baseline routine is deep-copied and never mutated. A proposal cannot set a replay result or deploy a routine. The catalog currently used by the demo is a synthetic fixture; replace it with Person 2's canonical household catalog before production use.

## Alexa+ adapter boundary

The included adapter is a `SIMULATED DEMO`: JSON-RPC-style `initialize`, `tools/list`, and `tools/call` over local `POST /mcp`. Tools are typed and household-scoped; draft/replay calls clearly mark proposed/simulated actions versus execution. This is not a claim of standards-complete remote MCP transport or live Alexa+ integration.

Live Alexa+ is `BLOCKED` until current access is verified and the required Streamable HTTP transport, MCP 2025-11-25, OAuth 2.1 + PKCE, remote URL, and developer account are available. Do not advertise connected devices or Amazon accounts.
