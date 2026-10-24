# Changelog (Person B revision, 22 Oct 2026)
- assertions: `final_state_equals` now supports one `time_between` window (state at window end); unsupported/ambiguous time info and unsupported operators return INCONCLUSIVE with reason.
- simulator: unsupported condition operator evaluates UNKNOWN (previously fell through as `neq`); output exposes scenario `window`. `result_hash` unchanged.
- regression: structured relevance (direct/indirect/global/ambiguous/none), auto scenario binding, `not_exercised` list, `binding`/`relevance` per test.
- services: atomic check-then-write for confirm/patch/approve/replay/candidate-create (fixes race); `STALE_REPLAY` approval guard; replays record `routine_versions` + `requirement_statuses`; `same_scenario_versions` in comparisons; `failure_evidence` in reports; `verify_reproducible`.
- store/seed: migration `002_integrity` (append-only triggers, indexes); demo reset now deletes only demo households (previously wiped every table).
- main: `GET /replays/{id}/verify`; consistent JSON errors for 404/405; reset restricted to hh_demo owner; startup warning in demo mode.
- tests: +49 (`tests/test_extended.py`); `test_benchmark.py` count 6 -> 9 because 3 benchmark cases were added (no assertion weakened). benchmark: +3 cases.
- scenario `seed`: documented as intentionally inert (no randomness added).
