> **Note (final integration):** the Person 2 / Person 3C contracts described here have been reconciled. The frozen shared contract (canonical room/device ids, translation tables, routes) is **[docs/CONTRACTS.md](../../docs/CONTRACTS.md)**; overall status is **[FINAL_SUBMISSION_STATUS.md](../../FINAL_SUBMISSION_STATUS.md)**. Text below is the original document, kept for history.

# SWITCH backend integration contract (SIMULATED DEMO)

Base URL `http://127.0.0.1:8000` (`SWITCH_HOST`/`SWITCH_PORT`). Header `Authorization: Bearer <token>`. Errors: `{"error":{"code","message","details":[{code,path,message}]}}`.
Demo-only tokens: `demo-owner-token` (owner), `demo-member-token`, `demo-viewer-token`, `other-owner-token` (other household). Not real credentials.
Env: `SWITCH_DB`, `SWITCH_ENV` (`demo` default), `SWITCH_CORS_ORIGINS` (comma list), `SWITCH_HOST`, `SWITCH_PORT`.

## Person A (frontend) - verified against the backend only, NOT against the real UI
Journey -> calls: overview `GET /routines,/requirements,/candidates` | open requirement `GET /requirements/req-hallway-occupied` | diff `GET /candidates/cand-demo-faulty/diff` | run replay `POST /replays {candidate_id}` | FAIL + violating event `suite.tests[i].evidence_event_ids` into `suite.tests[i].trace[]` (or `GET /replays/{id}/report` -> `failure_evidence[].events`) | proposed repair `POST /candidates/{id}/suggest-fix {}` -> new unverified candidate (+`routine_diff_vs_parent`) | re-run `POST /replays {candidate_id: <new>}` (`comparison_to_previous_run.fixed/newly_failing`) | report `GET /replays/{id}/report` | approve/reject `POST /candidates/{id}/approve {decision,note?}` (owner; 403 for member/viewer; 409 `SUITE_NOT_PASSING|STALE_REPLAY|VERIFICATION_REQUIRED`) | reproduce `GET /replays/{id}/verify`.
UI must show: `environment` ("SIMULATED DEMO"), PASS/FAIL/INCONCLUSIVE distinctly, `suite.excluded` (DRAFT/DISABLED/RETIRED), `suite.not_applicable` (incl. `ambiguous`), `suite.not_exercised`, `tests[].binding`/`relevance`, `approval.deployed=false`. Never compute results client-side. Handle 401/403/404/409/422 using `error.code`.

## Person C (AI) - NOT PROVIDED, NOT CONNECTED
Existing safe entry points (all schema-validated, unknown devices/ops/conditions rejected with 422, nothing auto-confirmed):
- Draft: `POST /requirements/drafts {source_correction, structured:{title,scope{routine_ids,devices,scenario_ids},preconditions[{op:eq|neq|time_between,...}],expected_behavior{kind:must_not_set|final_state_equals,device,attr,value},ambiguities[],confidence 0..1,interpreter}}` -> 201 DRAFT. Non-empty `ambiguities` blocks confirmation (409 `NEEDS_CLARIFICATION`). Without `structured`, only a single regex fallback runs (`interpreter:"rule_based_fallback"`); other phrasing -> 422 `INTERPRETATION_UNAVAILABLE`.
- Repair: `POST /candidates/{id}/suggest-fix {repair_ops:[{op:add_action_condition|add_routine_condition|remove_action|add_action,...}]}` -> isolated, unverified candidate. Omit `repair_ops` for the deterministic guard-restoring fallback.
- Failure explanation: ground on `GET /replays/{id}/report` -> `failure_evidence[].events` (real trace). The AI must never write PASS/FAIL/INCONCLUSIVE; only `POST /replays` produces them.
Not implemented: an outbound AI client, AI env vars, authentication between services.
