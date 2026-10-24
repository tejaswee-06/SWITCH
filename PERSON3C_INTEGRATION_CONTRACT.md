> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# Person 3C ↔ Person 2 integration contract

## Authority and status

- Person 2 FastAPI service is the canonical source for routine/requirement persistence and deterministic replay outcomes.
- Person 3C interprets corrections and proposes repairs. It never sets PASS, FAIL, or INCONCLUSIVE.
- All current behavior is simulated. No physical device or live Alexa+ integration is claimed.

## Integrated routes

All `/person3c/*` routes except where noted require the same bearer token as Person 2 and derive household scope from the authenticated principal.

| Method / route | Purpose | Status |
|---|---|---|
| `GET /person3c/status` | Interpreter, artifact, evaluator, and Alexa status | IMPLEMENTED |
| `POST /person3c/interpret` | Body `{ "text": "...", "context": {} }`; household is server-derived; returns DRAFT | IMPLEMENTED; local fixture catalog |
| `POST /person3c/repair/propose` | Validated proposal with baseline, operation list, failed requirement, routine version, trace event IDs | IMPLEMENTED; proposal only |
| `GET /person3c/alexa/status` | Simulation mode and live blocker | SIMULATED / BLOCKED |
| `POST /person3c/mcp` | MCP-style local JSON-RPC adapter scoped to authenticated household | SIMULATED |

## Canonical flow

1. Person 3C returns a DRAFT correction interpretation.
2. The user reviews and clarifies the draft.
3. The original correction may be submitted to Person 2's `POST /requirements/drafts` endpoint. This creates a separate Person 2 DRAFT; it is not an automatic confirmation of the Person 3C interpretation.
4. A human explicitly confirms the Person 2 requirement.
5. Person 2 runs replay and produces the authoritative PASS/FAIL/INCONCLUSIVE result with trace evidence.
6. A repair proposal remains unverified until mapped to the canonical Person 2 routine schema, validated, reviewed by a human, and rerun through Person 2.

## Known schema gap

Person 3C currently uses `hallway_light` and signal-style conditions such as `hallway_occupancy == true`; Person 2's canonical catalog includes `hallway_light` and uses a distinct `Condition` schema (`device`, `attr`, `op`, `value`). The current Person 3C catalog is a local fixture and must not be treated as a canonical catalog adapter. Before automatic repair application or direct confirmation, implement explicit mapping and contract tests for IDs, condition semantics, routine versions, and trace event identifiers.

## Trust and release boundaries

- AI output and heuristic confidence do not prove correctness.
- Missing or unknown sensor state must remain INCONCLUSIVE in the deterministic evaluator.
- Drafts require explicit confirmation.
- Repair proposals require human review and a fresh deterministic regression replay.
- No auto-deploy, auto-approve, or physical-home safety guarantee.
- Live Alexa+ remains blocked until access, transport, protocol version, OAuth 2.1 + PKCE, remote URL, and developer account are verified.
