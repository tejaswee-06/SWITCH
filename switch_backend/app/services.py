"""Business logic: requirement lifecycle, candidates, replays, repairs, approvals.
All reads/writes are household-scoped; foreign records look like 404."""
import json, re, sqlite3, uuid
from typing import Optional
from .catalog import CATALOG
from .errors import ApiError
from .schemas import Routine, Scenario, RequirementContent, RepairOp, Condition
from .store import Store, now, INSERT_CANDIDATE
from . import p3c_bridge as PB
from .validation import validate_routine, validate_requirement
from .diff import diff_routines, apply_repair, derive_restore_guard_ops, RepairError
from .regression import run_suite, compare
from .simulator import SIMULATOR_VERSION
from .assertions import PASS, FAIL, INCONCLUSIVE

ALEXA_ADAPTER_VERSION = "switch-alexa-sim/1.0.0"
SAFETY = ("SIMULATED DEMO. A PASS means only that the selected modeled requirements passed for the recorded scenarios "
          "and versions. It does not certify a real home, real devices, firmware, latency or outages.")
ROLE_RANK = {"viewer": 0, "member": 1, "owner": 2}


def need(p: dict, role: str):
    if ROLE_RANK[p["role"]] < ROLE_RANK[role]:
        raise ApiError(403, "FORBIDDEN", f"requires role '{role}' or higher")


def uid(prefix): return f"{prefix}-{uuid.uuid4().hex[:10]}"


class Services:
    def __init__(self, st: Store):
        self.st = st

    # ---------- loaders (household scoped) ----------
    def _req_row(self, hh, rid):
        r = self.st.one("SELECT * FROM requirements WHERE requirement_id=? AND household_id=?", (rid, hh))
        if not r:
            raise ApiError(404, "NOT_FOUND", f"requirement '{rid}' not found")
        return r

    def _content(self, rid, version) -> RequirementContent:
        v = self.st.one("SELECT content FROM requirement_versions WHERE requirement_id=? AND version=?", (rid, version))
        return RequirementContent.model_validate(json.loads(v["content"]))

    def _req_out(self, row) -> dict:
        c = self._content(row["requirement_id"], row["current_version"])
        return {"requirement_id": row["requirement_id"], "household_id": row["household_id"], "version": row["current_version"],
                "status": row["status"], **c.model_dump(), "confirmation": json.loads(row["confirmation"]) if row["confirmation"] else None,
                "last_result": json.loads(row["last_result"]) if row["last_result"] else None,
                "created_at": row["created_at"], "created_by": row["created_by"], "updated_at": row["updated_at"]}

    def _cand_row(self, hh, cid):
        r = self.st.one("SELECT * FROM candidates WHERE candidate_id=? AND household_id=?", (cid, hh))
        if not r:
            raise ApiError(404, "NOT_FOUND", f"candidate '{cid}' not found")
        return r

    def _cand_out(self, r) -> dict:
        return {"candidate_id": r["candidate_id"], "routine_id": r["routine_id"], "base_version": r["base_version"],
                "version": r["version"], "parent_candidate_id": r["parent_candidate_id"], "status": r["status"],
                "routine": json.loads(r["routine"]), "repair_ops": json.loads(r["repair"]) if r["repair"] else None,
                "repair_source": r["repair_source"], "created_by": r["created_by"], "created_at": r["created_at"],
                "description": json.loads(r["routine"]).get("description"),
                "repair_provenance": json.loads(r["repair_provenance"]) if r.get("repair_provenance") else None,
                "verified": False if r["repair"] else None,
                "note": "Not verified until a replay of this candidate version is run." if r["repair"] else None}

    def _baseline(self, hh, routine_id, version=None) -> Optional[Routine]:
        q = "SELECT json FROM routines WHERE household_id=? AND routine_id=?"
        a = [hh, routine_id]
        if version is not None:
            q += " AND version=?"; a.append(version)
        r = self.st.one(q + " ORDER BY version DESC LIMIT 1", tuple(a))
        return Routine.model_validate(json.loads(r["json"])) if r else None

    def _scenarios(self, hh, include_edge: bool = False) -> dict[str, Scenario]:
        """Household scenarios (latest version each). Edge-case scenarios are only used by explicit exploratory runs."""
        out = {}
        for r in self.st.all("SELECT json FROM scenarios WHERE household_id=? ORDER BY scenario_id, version", (hh,)):
            s = Scenario.model_validate(json.loads(r["json"]))
            out[s.scenario_id] = s          # later (higher) version overwrites
        return out if include_edge else {k: v for k, v in out.items() if not v.edge_case}

    def list_scenarios(self, p) -> list[dict]:
        return [s.model_dump() for s in self._scenarios(p["household_id"], include_edge=True).values()]

    def _latest_routines(self, hh) -> list[Routine]:
        rows = self.st.all("SELECT routine_id, MAX(version) v FROM routines WHERE household_id=? GROUP BY routine_id ORDER BY routine_id", (hh,))
        return [self._baseline(hh, r["routine_id"], r["v"]) for r in rows]

    def _scenarios_at(self, hh, versions: dict) -> dict[str, Scenario]:
        out = {}
        for sid, v in versions.items():
            r = self.st.one("SELECT json FROM scenarios WHERE household_id=? AND scenario_id=? AND version=?", (hh, sid, v))
            if not r:
                raise ApiError(409, "REPRODUCTION_IMPOSSIBLE", f"scenario '{sid}' v{v} is no longer stored")
            out[sid] = Scenario.model_validate(json.loads(r["json"]))
        return out

    # ---------- requirements ----------
    def _fallback_interpret(self, text: str, routine_ids, scenario_ids) -> RequirementContent:
        m = re.search(r"(?:don['’]?t|do not|never)\s+turn\s+off\s+the\s+(\w+)\s+light\s+while\s+(?:someone|anyone|somebody|people)\s+(?:is|are)\s+(?:there|home|present|in (?:there|it))", text, re.I)
        if not m:
            raise ApiError(422, "INTERPRETATION_UNAVAILABLE",
                           "No AI interpreter is configured and the rule-based fallback only understands "
                           "\"Don't turn off the <room> light while someone is there\". Supply 'structured'.")
        room = m.group(1).lower()
        light, occ = f"{room}_light", f"{room}_occupancy"
        if light not in CATALOG or occ not in CATALOG:
            raise ApiError(422, "UNKNOWN_DEVICE", f"no modeled device '{light}'/'{occ}'")
        return RequirementContent.model_validate({
            "title": f"Do not turn off the {room} light while someone is there", "source_correction": text,
            "scope": {"routine_ids": routine_ids, "devices": [light], "scenario_ids": scenario_ids},
            "preconditions": [{"op": "eq", "device": occ, "attr": "occupied", "value": True}],
            "expected_behavior": {"kind": "must_not_set", "device": light, "attr": "power", "value": "off"},
            "confidence": 0.6, "interpreter": "rule_based_fallback"})

    def interpret(self, p, body: dict) -> dict:
        """Person 3C interpretation -> canonical proposal. Read-only: nothing is stored, nothing is confirmed."""
        hh = p["household_id"]
        return PB.interpret(hh, body["text"], self._latest_routines(hh), self._scenarios(hh), body.get("context"), body.get("answers"))

    def create_draft(self, p, body: dict) -> dict:
        need(p, "member")
        if body.get("structured") is None and body.get("interpreter") == "p3c":
            hh = p["household_id"]
            res = PB.interpret(hh, body["source_correction"], self._latest_routines(hh), self._scenarios(hh), body.get("context"), body.get("answers"))
            if not res["structured"]:
                raise ApiError(422, "NEEDS_CLARIFICATION", "the correction cannot become a draft until it is clarified; nothing was saved",
                               [{"code": "AMBIGUITY", "path": q["field"], "message": q["question"], "options": q["options"], "answer_key": q["answer_key"]}
                                for q in res["questions"]] or [{"code": i["code"], "path": i["path"], "message": i["message"]} for i in res["issues"]])
            body = {**body, "structured": res["structured"]}
            if body.get("scenario_ids"):
                body["structured"]["scope"]["scenario_ids"] = body["scenario_ids"]
        if body.get("structured") is not None:
            data = dict(body["structured"]); data.setdefault("source_correction", body["source_correction"])
            try:
                spec = RequirementContent.model_validate(data)
            except Exception as e:   # pydantic ValidationError -> sanitized
                raise ApiError(422, "REQUIREMENT_INVALID", "structured requirement is malformed",
                               [{"code": "SCHEMA", "path": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in getattr(e, "errors", lambda: [])()])
        else:
            spec = self._fallback_interpret(body["source_correction"], body.get("routine_ids", []), body.get("scenario_ids", []))
        issues = validate_requirement(spec)
        if issues:
            raise ApiError(422, "REQUIREMENT_INVALID", "requirement failed validation", issues)
        rid, t = uid("req"), now()
        with self.st.tx():
            self.st.run("INSERT INTO requirements VALUES (?,?,?,?,?,?,?,?,?)", (rid, p["household_id"], 1, "DRAFT", None, None, t, p["user_id"], t))
            self.st.run("INSERT INTO requirement_versions VALUES (?,?,?,?,?,?)", (rid, 1, json.dumps(spec.model_dump(exclude_none=True)), p["user_id"], t, "draft created"))
            self.st.audit(p["household_id"], p["user_id"], "requirement_draft_created", "requirement", rid, {"interpreter": spec.interpreter})
        return self._req_out(self._req_row(p["household_id"], rid))

    def confirm(self, p, rid, version: int):
        with self.st.tx():          # atomic check-then-write (BEGIN IMMEDIATE)
            return self._confirm(p, rid, version)

    def _confirm(self, p, rid, version: int) -> dict:
        need(p, "owner")
        row = self._req_row(p["household_id"], rid)
        if row["current_version"] != version:
            raise ApiError(409, "VERSION_CONFLICT", f"current version is {row['current_version']}, not {version}")
        if row["status"] == "RETIRED":
            raise ApiError(409, "INVALID_TRANSITION", "RETIRED requirements cannot be confirmed")
        if row["status"] == "CONFIRMED":
            raise ApiError(409, "INVALID_TRANSITION", "already CONFIRMED")
        spec = self._content(rid, version)
        if spec.ambiguities:
            raise ApiError(409, "NEEDS_CLARIFICATION", "requirement has unresolved ambiguities and must stay a draft", [{"code": "AMBIGUITY", "path": "ambiguities", "message": a} for a in spec.ambiguities])
        issues = validate_requirement(spec)
        if issues:
            raise ApiError(422, "REQUIREMENT_INVALID", "requirement failed validation", issues)
        conf = {"by": p["user_id"], "at": now(), "version": version}
        with self.st.tx():
            self.st.run("UPDATE requirements SET status='CONFIRMED', confirmation=?, updated_at=? WHERE requirement_id=?", (json.dumps(conf), now(), rid))
            self.st.audit(p["household_id"], p["user_id"], "requirement_confirmed", "requirement", rid, {"version": version})
        return self._req_out(self._req_row(p["household_id"], rid))

    def patch_requirement(self, p, rid, body: dict):
        with self.st.tx():          # atomic check-then-write (BEGIN IMMEDIATE)
            return self._patch_requirement(p, rid, body)

    def _patch_requirement(self, p, rid, body: dict) -> dict:
        need(p, "member")
        row = self._req_row(p["household_id"], rid)
        if row["current_version"] != body["expected_version"]:
            raise ApiError(409, "VERSION_CONFLICT", f"current version is {row['current_version']}, not {body['expected_version']}")
        if row["status"] == "RETIRED":
            raise ApiError(409, "INVALID_TRANSITION", "RETIRED requirements are immutable")
        new_status = body.get("status")
        content = body.get("content")
        if new_status is None and content is None:
            raise ApiError(422, "EMPTY_PATCH", "provide 'content' and/or 'status'")
        if new_status is not None and new_status not in ("DISABLED", "RETIRED"):
            raise ApiError(422, "INVALID_TRANSITION", "PATCH may only set status DISABLED or RETIRED; use /confirm to (re)confirm")
        if new_status:
            need(p, "owner")
        with self.st.tx():
            if content is not None:
                cur = self._content(rid, row["current_version"]).model_dump(exclude_none=True)
                cur.update(content)
                try:
                    spec = RequirementContent.model_validate(cur)
                except Exception as e:
                    raise ApiError(422, "REQUIREMENT_INVALID", "edited requirement is malformed",
                                   [{"code": "SCHEMA", "path": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in getattr(e, "errors", lambda: [])()])
                issues = validate_requirement(spec)
                if issues:
                    raise ApiError(422, "REQUIREMENT_INVALID", "requirement failed validation", issues)
                nv = row["current_version"] + 1
                self.st.run("INSERT INTO requirement_versions VALUES (?,?,?,?,?,?)", (rid, nv, json.dumps(spec.model_dump(exclude_none=True)), p["user_id"], now(), body.get("note", "edited")))
                # an edited requirement must be re-reviewed: it returns to DRAFT (not enforced) until confirmed again
                st = new_status or "DRAFT"
                self.st.run("UPDATE requirements SET current_version=?, status=?, confirmation=NULL, updated_at=? WHERE requirement_id=?", (nv, st, now(), rid))
                self.st.audit(p["household_id"], p["user_id"], "requirement_edited", "requirement", rid, {"new_version": nv, "status": st})
            else:
                self.st.run("UPDATE requirements SET status=?, updated_at=? WHERE requirement_id=?", (new_status, now(), rid))
                self.st.audit(p["household_id"], p["user_id"], f"requirement_{new_status.lower()}", "requirement", rid)
        return self._req_out(self._req_row(p["household_id"], rid))

    def list_requirements(self, p, status=None, device=None, routine_id=None, last_result=None) -> list[dict]:
        rows = self.st.all("SELECT * FROM requirements WHERE household_id=? ORDER BY requirement_id", (p["household_id"],))
        out = [self._req_out(r) for r in rows]
        if status: out = [r for r in out if r["status"] == status]
        if device: out = [r for r in out if r["expected_behavior"]["device"] == device or device in r["scope"]["devices"]]
        if routine_id: out = [r for r in out if routine_id in r["scope"]["routine_ids"]]
        if last_result: out = [r for r in out if r["last_result"] and r["last_result"]["status"] == last_result]
        return out

    def get_requirement(self, p, rid):
        return self._req_out(self._req_row(p["household_id"], rid))

    def requirement_versions(self, p, rid) -> dict:
        self._req_row(p["household_id"], rid)
        vs = self.st.all("SELECT version, content, changed_by, changed_at, note FROM requirement_versions WHERE requirement_id=? ORDER BY version", (rid,))
        ev = self.st.all("SELECT actor, action, detail, at FROM audit_log WHERE entity_type='requirement' AND entity_id=? ORDER BY id", (rid,))
        return {"requirement_id": rid, "versions": [{**v, "content": json.loads(v["content"])} for v in vs],
                "audit": [{**e, "detail": json.loads(e["detail"])} for e in ev]}

    # ---------- candidates ----------
    def create_candidate(self, p, routine: Routine, parent=None, repair=None, repair_source=None, note=None, provenance=None) -> dict:
        try:
            with self.st.tx():
                return self._create_candidate(p, routine, parent, repair, repair_source, note, provenance)
        except sqlite3.IntegrityError:
            raise ApiError(409, "VERSION_CONFLICT", f"a candidate for '{routine.routine_id}' v{routine.version} already exists")

    def _create_candidate(self, p, routine: Routine, parent=None, repair=None, repair_source=None, note=None, provenance=None) -> dict:
        need(p, "member")
        issues = validate_routine(routine)
        if issues:
            raise ApiError(422, "ROUTINE_INVALID", "routine failed validation", issues)
        base = self._baseline(p["household_id"], routine.routine_id)
        if base is None:
            raise ApiError(404, "ROUTINE_NOT_FOUND", f"no baseline routine '{routine.routine_id}' to compare against")
        if routine.version <= base.version:
            raise ApiError(409, "VERSION_CONFLICT", f"candidate version must be > baseline version {base.version}")
        if self.st.one("SELECT 1 FROM candidates WHERE household_id=? AND routine_id=? AND version=?", (p["household_id"], routine.routine_id, routine.version)):
            raise ApiError(409, "VERSION_CONFLICT", f"a candidate for '{routine.routine_id}' v{routine.version} already exists")
        cid = uid("cand")
        with self.st.tx():
            self.st.run(INSERT_CANDIDATE, (cid, p["household_id"], routine.routine_id, base.version, routine.version,
                        parent, json.dumps(routine.model_dump(exclude_none=True)), json.dumps(repair) if repair else None, repair_source, "PENDING_REVIEW", p["user_id"], now(),
                        json.dumps(provenance) if provenance else None))
            self.st.audit(p["household_id"], p["user_id"], "candidate_created", "candidate", cid, {"routine": routine.routine_id, "version": routine.version, "parent": parent})
        return self._cand_out(self._cand_row(p["household_id"], cid))

    def get_candidate(self, p, cid): return self._cand_out(self._cand_row(p["household_id"], cid))

    def list_candidates(self, p):
        return [self._cand_out(r) for r in self.st.all("SELECT * FROM candidates WHERE household_id=? ORDER BY created_at, candidate_id", (p["household_id"],))]

    def routine_diff(self, p, routine_id: str, frm: int, to: int) -> dict:
        """Diff between two versions of a routine; a version may be a stored baseline or a candidate version."""
        hh = p["household_id"]
        def load(v):
            r = self._baseline(hh, routine_id, v)
            if r is not None and r.version == v:
                return r, "baseline"
            c = self.st.one("SELECT routine FROM candidates WHERE household_id=? AND routine_id=? AND version=?", (hh, routine_id, v))
            if c:
                return Routine.model_validate(json.loads(c["routine"])), "candidate"
            raise ApiError(404, "NOT_FOUND", f"routine '{routine_id}' v{v} not found")
        a, ka = load(frm)
        b, kb = load(to)
        return {"routine_id": routine_id, "from": {"version": frm, "kind": ka}, "to": {"version": to, "kind": kb},
                "changes": diff_routines(a, b), "before": a.model_dump(exclude_none=True), "after": b.model_dump(exclude_none=True)}

    def candidate_diff(self, p, cid) -> dict:
        r = self._cand_row(p["household_id"], cid)
        base = self._baseline(p["household_id"], r["routine_id"], r["base_version"])
        cand = Routine.model_validate(json.loads(r["routine"]))
        return {"candidate_id": cid, "baseline_version": base.version, "candidate_version": cand.version, "changes": diff_routines(base, cand),
                "baseline": base.model_dump(exclude_none=True), "candidate": cand.model_dump(exclude_none=True)}

    # ---------- replay ----------
    def _requirements_for_run(self, hh, ids=None):
        rows = self.st.all("SELECT * FROM requirements WHERE household_id=? ORDER BY requirement_id", (hh,))
        if ids:
            known = {r["requirement_id"] for r in rows}
            for i in ids:
                if i not in known:
                    raise ApiError(404, "NOT_FOUND", f"requirement '{i}' not found")
            rows = [r for r in rows if r["requirement_id"] in set(ids)]
        return [{"requirement_id": r["requirement_id"], "version": r["current_version"], "status": r["status"],
                 "spec": self._content(r["requirement_id"], r["current_version"])} for r in rows]

    def _household_routines(self, hh, replace: Routine) -> list[Routine]:
        out = []
        for r in self.st.all("SELECT routine_id, MAX(version) v FROM routines WHERE household_id=? GROUP BY routine_id", (hh,)):
            if r["routine_id"] != replace.routine_id:
                out.append(self._baseline(hh, r["routine_id"], r["v"]))
        return out + [replace]

    def replay(self, p, candidate_id, requirement_ids=None, compare_to_run_id=None, extra_scenario_ids=None, via="api", correlation_id=None):
        with self.st.tx():          # atomic check-then-write (BEGIN IMMEDIATE)
            return self._replay(p, candidate_id, requirement_ids, compare_to_run_id, extra_scenario_ids, via, correlation_id)

    def _replay(self, p, candidate_id, requirement_ids=None, compare_to_run_id=None, extra_scenario_ids=None, via="api", correlation_id=None) -> dict:
        need(p, "member")
        hh = p["household_id"]
        row = self._cand_row(hh, candidate_id)
        cand = Routine.model_validate(json.loads(row["routine"]))
        base = self._baseline(hh, row["routine_id"], row["base_version"])
        issues = validate_routine(cand)
        if issues:
            raise ApiError(422, "ROUTINE_INVALID", "candidate failed validation; replay refused", issues)
        reqs = self._requirements_for_run(hh, requirement_ids)
        scen = self._scenarios(hh)
        extra = sorted(set(extra_scenario_ids or []))
        if extra:
            every = self._scenarios(hh, include_edge=True)
            missing = [s for s in extra if s not in every]
            if missing:
                raise ApiError(404, "NOT_FOUND", f"scenario(s) {missing} not found")
            scen = {**scen, **{s: every[s] for s in extra}}
            # exploratory: also evaluate every selected requirement in the requested edge-case scenarios
            reqs = [{**r, "spec": r["spec"].model_copy(update={"scope": r["spec"].scope.model_copy(update={
                "scenario_ids": sorted(set(r["spec"].scope.scenario_ids) | set(extra))})})} for r in reqs]
        hh_routines = self._household_routines(hh, cand)
        suite = run_suite(hh_routines, cand, reqs, scen)
        baseline_suite = run_suite(self._household_routines(hh, base), base, reqs, scen, include_traces=False)
        base_by = {(t["requirement_id"], t["scenario_id"]): t["status"] for t in baseline_suite["tests"]}
        for t in suite["tests"]:
            t["baseline_status"] = base_by.get((t["requirement_id"], t["scenario_id"]))
        prev = None
        if compare_to_run_id:
            prev = self._run_row(hh, compare_to_run_id)
        elif row["parent_candidate_id"]:
            prev = self.st.one("SELECT * FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, row["parent_candidate_id"]))
        comparison = None
        if prev:
            pj = json.loads(prev["json"])
            same_sc = pj.get("scenario_versions") == {k: v.version for k, v in scen.items()}
            same_rq = pj.get("requirement_versions") == {r["requirement_id"]: r["version"] for r in reqs}
            comparison = {"previous_run_id": prev["run_id"], "same_scenario_versions": same_sc, "same_requirement_versions": same_rq,
                          "inputs_note": "scenario inputs identical to the previous run" if same_sc else "WARNING: scenario versions differ from the previous run; before/after is not like-for-like",
                          **compare(pj["suite"]["tests"], suite["tests"])}
        run_id = uid("run")
        kind = "exploratory" if extra else ("targeted" if requirement_ids else "full")
        diff = diff_routines(base, cand)
        rec = {"run_id": run_id, "environment": "SIMULATED DEMO", "kind": kind, "simulator_version": SIMULATOR_VERSION,
               "created_at": now(), "created_by": p["user_id"], "household_id": hh,
               "candidate": {"candidate_id": candidate_id, "routine_id": cand.routine_id, "routine_version": cand.version,
                             "baseline_version": base.version, "parent_candidate_id": row["parent_candidate_id"]},
               "requirement_versions": {r["requirement_id"]: r["version"] for r in reqs},
               "requirement_statuses": {r["requirement_id"]: r["status"] for r in reqs},
               "routine_versions": {r.routine_id: r.version for r in hh_routines},
               "scenario_versions": {k: v.version for k, v in scen.items()},
               "routine_diff": diff, "suite": suite,
               "baseline_comparison": {"overall": baseline_suite["overall"], "totals": baseline_suite["totals"],
                                       "regressed_vs_baseline": [{"requirement_id": t["requirement_id"], "scenario_id": t["scenario_id"], "baseline": t["baseline_status"], "candidate": t["status"]}
                                                                 for t in suite["tests"] if t["baseline_status"] == PASS and t["status"] != PASS]},
               "comparison_to_previous_run": comparison, "safety_statement": SAFETY,
               "exploratory_scenario_ids": extra,
               "candidate_description": cand.description,
               "integration": {"integration_mode": "simulated_demo", "source_provenance": "local_fixture", "invoked_via": via,
                               "correlation_id": correlation_id, "adapter_version": ALEXA_ADAPTER_VERSION if via == "alexa_simulated" else None}}
        with self.st.tx():
            self.st.run("INSERT INTO replays VALUES (?,?,?,?,?,?,?,?)", (run_id, hh, candidate_id, kind, suite["overall"], rec["created_at"], p["user_id"], json.dumps(rec)))
            worst = {}
            for t in suite["tests"]:
                rank = {PASS: 0, INCONCLUSIVE: 1, FAIL: 2}
                if t["requirement_id"] not in worst or rank[t["status"]] > rank[worst[t["requirement_id"]]]:
                    worst[t["requirement_id"]] = t["status"]
            for rid, s in (worst.items() if kind != "exploratory" else []):   # exploratory runs never change last_result
                self.st.run("UPDATE requirements SET last_result=? WHERE requirement_id=?", (json.dumps({"status": s, "run_id": run_id, "candidate_id": candidate_id}), rid))
            self.st.audit(hh, p["user_id"], "replay_completed", "replay", run_id, {"candidate": candidate_id, "overall": suite["overall"]})
        return rec

    def _run_row(self, hh, run_id):
        r = self.st.one("SELECT * FROM replays WHERE run_id=? AND household_id=?", (run_id, hh))
        if not r:
            raise ApiError(404, "NOT_FOUND", f"replay '{run_id}' not found")
        return r

    def get_replay(self, p, run_id): return json.loads(self._run_row(p["household_id"], run_id)["json"])

    def list_replays(self, p, candidate_id=None):
        q, a = "SELECT run_id, candidate_id, kind, overall, created_at, created_by FROM replays WHERE household_id=?", [p["household_id"]]
        if candidate_id:
            q += " AND candidate_id=?"; a.append(candidate_id)
        return self.st.all(q + " ORDER BY created_at, rowid", tuple(a))

    def report(self, p, run_id) -> dict:
        run = self.get_replay(p, run_id)
        cid = run["candidate"]["candidate_id"]
        cand = self._cand_row(p["household_id"], cid)
        decisions = self.st.all("SELECT approval_id, run_id, decision, note, decided_by, decided_at FROM approvals WHERE household_id=? AND candidate_id=? ORDER BY decided_at, rowid", (p["household_id"], cid))
        fails = [t for t in run["suite"]["tests"] if t["status"] == FAIL]
        lines = [f"Run {run_id}: suite {run['suite']['overall']} ({run['suite']['totals']})."]
        for t in fails:
            lines.append(f"FAIL {t['requirement_id']} v{t['requirement_version']} in {t['scenario_id']}: {t['reason']}; evidence {t['evidence_event_ids']}")
        for t in run["suite"]["tests"]:
            if t["status"] == INCONCLUSIVE:
                lines.append(f"INCONCLUSIVE {t['requirement_id']} in {t['scenario_id']}: {t['reason']}")
        for e in run["suite"]["excluded"]:
            lines.append(f"NOT ENFORCED {e['requirement_id']}: {e['reason']}")
        failure_evidence = [{"requirement_id": t["requirement_id"], "requirement_version": t["requirement_version"], "scenario_id": t["scenario_id"],
                             "reason": t["reason"], "events": [e for e in t.get("trace", []) if e["event_id"] in t["evidence_event_ids"]]} for t in fails]
        return {**run, "failure_evidence": failure_evidence, "candidate_status": cand["status"], "repair_ops": json.loads(cand["repair"]) if cand["repair"] else None,
                "repair_provenance": json.loads(cand["repair_provenance"]) if cand.get("repair_provenance") else None,
                "candidate_parent_id": cand["parent_candidate_id"],
                "reviewer_decisions": decisions, "summary": lines, "reproducibility": {
                    "input_fingerprint": run["suite"]["input_fingerprint"], "simulator_version": run["simulator_version"],
                    "requirement_versions": run["requirement_versions"], "scenario_versions": run["scenario_versions"],
                    "routine": run["candidate"]}}

    def verify_reproducible(self, p, run_id) -> dict:
        """Re-simulate a stored run from the EXACT recorded routine/requirement/scenario versions (not current ones)
        and compare. Read-only: nothing is written."""
        hh = p["household_id"]
        run = self.get_replay(p, run_id)
        if "routine_versions" not in run:
            raise ApiError(409, "REPRODUCTION_IMPOSSIBLE", "run predates pinned-input recording")
        cand_row = self._cand_row(hh, run["candidate"]["candidate_id"])
        cand = Routine.model_validate(json.loads(cand_row["routine"]))
        routines = []
        for rid, v in sorted(run["routine_versions"].items()):
            routines.append(cand if rid == cand.routine_id else self._baseline(hh, rid, v))
        reqs = []
        for rid, v in sorted(run["requirement_versions"].items()):
            self._req_row(hh, rid)
            reqs.append({"requirement_id": rid, "version": v, "status": run["requirement_statuses"][rid], "spec": self._content(rid, v)})
        suite = run_suite(routines, cand, reqs, self._scenarios_at(hh, run["scenario_versions"]))
        key = lambda t: (t["requirement_id"], t["scenario_id"], t["status"], t["reason"], tuple(t["evidence_event_ids"]), t.get("sim_result_hash"))
        diffs = []
        old, new = [key(t) for t in run["suite"]["tests"]], [key(t) for t in suite["tests"]]
        if old != new:
            diffs.append({"field": "tests", "recorded": old, "recomputed": new})
        for f in ("overall", "input_fingerprint"):
            if run["suite"][f] != suite[f]:
                diffs.append({"field": f, "recorded": run["suite"][f], "recomputed": suite[f]})
        return {"run_id": run_id, "reproduced": not diffs, "differences": diffs, "overall": suite["overall"],
                "pinned": {"routines": run["routine_versions"], "requirements": run["requirement_versions"], "scenarios": run["scenario_versions"],
                           "simulator_version": run["simulator_version"], "current_simulator_version": SIMULATOR_VERSION}}

    # ---------- repair ----------
    def suggest_fix(self, p, cid, ops: Optional[list[dict]], proposal_source: Optional[str] = None) -> dict:
        need(p, "member")
        hh = p["household_id"]
        row = self._cand_row(hh, cid)
        cand = Routine.model_validate(json.loads(row["routine"]))
        base = self._baseline(hh, row["routine_id"], row["base_version"])
        if ops is not None:
            try:
                repair_ops = [RepairOp.model_validate(o) for o in ops]
            except Exception as e:
                raise ApiError(422, "REPAIR_INVALID", "repair diff is malformed",
                               [{"code": "SCHEMA", "path": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in getattr(e, "errors", lambda: [])()])
            source = "external_proposal"
            last_fail = self.st.one("SELECT json FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, cid))
            fails = [t for t in json.loads(last_fail["json"])["suite"]["tests"] if t["status"] == FAIL] if last_fail else []
            proposer = proposal_source or "external"
        else:
            last = self.st.one("SELECT json FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, cid))
            if not last:
                raise ApiError(409, "REPLAY_REQUIRED", "run a replay of this candidate first so the repair targets real failures")
            fails = [t for t in json.loads(last["json"])["suite"]["tests"] if t["status"] == FAIL]
            if not fails:
                raise ApiError(409, "NOTHING_TO_REPAIR", "the latest full replay has no FAIL results")
            devices = set()
            for t in fails:
                devices.add(self._content(t["requirement_id"], t["requirement_version"]).expected_behavior.device)
            repair_ops = derive_restore_guard_ops(base, cand, devices)
            if not repair_ops:
                raise ApiError(422, "NO_REPAIR_AVAILABLE", "the deterministic fallback cannot derive a guard-restoring repair; supply repair_ops")
            source = "deterministic_fallback"
            proposer = "rule_based_restore_guard"
            last_fail = last
        evidence = sorted({e for t in fails for e in t.get("evidence_event_ids", [])})
        provenance = {"proposer": proposer, "ai_model_used": False,
                      "proposer_label": {"rule_based_restore_guard": "Deterministic rule: restore conditions the baseline routine had on the failing device",
                                         "external": "External repair ops supplied by the caller"}.get(proposer, proposer),
                      "evidence": {"run_id": json.loads(last_fail["json"])["run_id"] if last_fail else None,
                                   "failed_requirements": sorted({t["requirement_id"] for t in fails}), "evidence_event_ids": evidence},
                      "verified": False, "verification_note": "Not verified until a full replay of the new candidate is run."}
        if source == "deterministic_fallback" or (proposal_source or "").startswith("p3c"):
            v = PB.validate_repair(hh, self._latest_routines(hh), cand, repair_ops, fails[0]["requirement_id"] if fails else "unknown", evidence)
            provenance["validator"] = {"name": "switch_p3c.repair.propose_repair (constrained allowlist + canonical catalog)", "status": "passed",
                                       "proposal_id": v["proposal_id"], "operation_count": v["operation_count"]}
        else:
            provenance["validator"] = {"name": "Person 2 schema/catalog validation only", "status": "passed_p2_validation",
                                       "note": "external ops are validated by the canonical routine validator; Person 3C allowlist not applied"}
        provenance["explanation"] = PB.explain_repair(fails, cand, repair_ops)
        top = self.st.one("SELECT MAX(version) v FROM candidates WHERE household_id=? AND routine_id=?", (hh, row["routine_id"]))["v"]
        try:
            fixed = apply_repair(cand, repair_ops, new_version=max(top, cand.version) + 1)
        except RepairError as e:
            raise ApiError(422, "REPAIR_INVALID", "repair diff failed validation", e.issues)
        fixed.description = f"Repair proposal for candidate {cid} (v{cand.version}); not verified until replayed."
        out = self.create_candidate(p, fixed, parent=cid, repair=[o.model_dump(exclude_none=True) for o in repair_ops], repair_source=source, provenance=provenance)
        out["routine_diff_vs_parent"] = diff_routines(cand, fixed)
        return out

    def preview_repair(self, p, cid) -> dict:
        """Read-only: derive the deterministic guard-restoring proposal for a failing candidate, validate it with the Person 3C
        constrained-repair validator, and return it WITHOUT creating a candidate."""
        hh = p["household_id"]
        row = self._cand_row(hh, cid)
        cand = Routine.model_validate(json.loads(row["routine"]))
        base = self._baseline(hh, row["routine_id"], row["base_version"])
        last = self.st.one("SELECT json FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, cid))
        if not last:
            raise ApiError(409, "REPLAY_REQUIRED", "run a replay of this candidate first so the repair targets real failures")
        fails = [t for t in json.loads(last["json"])["suite"]["tests"] if t["status"] == FAIL]
        if not fails:
            raise ApiError(409, "NOTHING_TO_REPAIR", "the latest full replay has no FAIL results")
        devices = {self._content(t["requirement_id"], t["requirement_version"]).expected_behavior.device for t in fails}
        ops = derive_restore_guard_ops(base, cand, devices)
        if not ops:
            raise ApiError(422, "NO_REPAIR_AVAILABLE", "the deterministic fallback cannot derive a guard-restoring repair")
        evidence = sorted({e for t in fails for e in t.get("evidence_event_ids", [])})
        v = PB.validate_repair(hh, self._latest_routines(hh), cand, ops, fails[0]["requirement_id"], evidence)
        return {"candidate_id": cid, "p2_repair_ops": [o.model_dump(exclude_none=True) for o in ops], "p3c_validation": v,
                "explanation": PB.explain_repair(fails, cand, ops), "status": "NEEDS_HUMAN_REVIEW", "verified": False, "deployed": False,
                "note": "Preview only; nothing was created. Submit via POST /candidates/{id}/suggest-fix to create an unverified candidate."}

    # ---------- approval ----------
    def decide(self, p, cid, decision: str, note: Optional[str]):
        with self.st.tx():          # atomic check-then-write (BEGIN IMMEDIATE)
            return self._decide(p, cid, decision, note)

    def _decide(self, p, cid, decision: str, note: Optional[str]) -> dict:
        need(p, "owner")
        hh = p["household_id"]
        row = self._cand_row(hh, cid)
        if row["status"] != "PENDING_REVIEW":
            raise ApiError(409, "INVALID_TRANSITION", f"candidate is already {row['status']}")
        last = self.st.one("SELECT run_id, overall FROM replays WHERE household_id=? AND candidate_id=? AND kind='full' ORDER BY created_at DESC, rowid DESC LIMIT 1", (hh, cid))
        if decision == "approve":
            if not last:
                raise ApiError(409, "VERIFICATION_REQUIRED", "no full regression replay exists for this candidate")
            if last["overall"] != PASS:
                raise ApiError(409, "SUITE_NOT_PASSING", f"latest full replay is {last['overall']}; approval refused")
            run = self.get_replay(p, last["run_id"])
            now_conf = {r["requirement_id"]: r["version"] for r in self._requirements_for_run(hh) if r["status"] == "CONFIRMED"}
            ran_conf = {k: v for k, v in run["requirement_versions"].items() if run.get("requirement_statuses", {}).get(k) == "CONFIRMED"}
            if now_conf != ran_conf or run["scenario_versions"] != {k: v.version for k, v in self._scenarios(hh).items()}:
                raise ApiError(409, "STALE_REPLAY", "confirmed requirements or scenarios changed after the latest replay; re-run the full suite before approving")
        status = "APPROVED" if decision == "approve" else "REJECTED"
        with self.st.tx():
            self.st.run("UPDATE candidates SET status=? WHERE candidate_id=?", (status, cid))
            aid = uid("appr")
            self.st.run("INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)", (aid, hh, cid, last["run_id"] if last else None, decision, note, p["user_id"], now()))
            self.st.audit(hh, p["user_id"], f"candidate_{decision}d" if decision == "approve" else "candidate_rejected", "candidate", cid, {"run_id": last["run_id"] if last else None})
        return {"candidate_id": cid, "status": status, "approval_id": aid, "run_id": last["run_id"] if last else None,
                "deployed": False, "note": "Approval is recorded only. Deployment to real devices is NOT IMPLEMENTED."}
