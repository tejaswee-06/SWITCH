"""Demo seed (SIMULATED DEMO). Tokens below are DEMO-ONLY fixtures, not secrets.

Profiles
  regression  the original Person 2 fixture set (hallway requirement pre-confirmed). Default for create_app()
              so the original test-suite keeps exercising exactly the data it was written for.
  journey     the product demo household (Casa Verde): the Goodnight routine shown in the 3D house, two
              seeded confirmed requirements, one disabled requirement, and a pending candidate edit that drops
              the hallway occupancy guard. The hallway requirement is created by the user during the demo.
"""
import hashlib, json
from . import fixtures as F
from .store import Store, now, INSERT_CANDIDATE

DEMO_TOKENS = {  # token -> (user_id, household, role)
    "demo-owner-token": ("olivia", "hh_demo", "owner"),
    "demo-member-token": ("mia", "hh_demo", "member"),
    "demo-viewer-token": ("victor", "hh_demo", "viewer"),
    "other-owner-token": ("otto", "hh_other", "owner"),
}
HH = "hh_demo"
DEMO_HOUSEHOLDS = ("hh_demo", "hh_other")
PROFILES = ("regression", "journey")


def h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _insert_requirement(st: Store, rid: str, status: str, spec, t: str):
    conf = {"by": "olivia", "at": t, "note": "seeded demo fixture, pre-confirmed by demo owner"} if status == "CONFIRMED" else None
    st.run("INSERT INTO requirements VALUES (?,?,?,?,?,?,?,?,?)", (rid, HH, 1, status, json.dumps(conf) if conf else None, None, t, "seed", t))
    st.run("INSERT INTO requirement_versions VALUES (?,?,?,?,?,?)", (rid, 1, json.dumps(spec.model_dump(exclude_none=True)), "seed", t, "seed"))


def seed(st: Store, profile: str = "regression"):
    if profile not in PROFILES:
        raise ValueError(f"unknown seed profile {profile!r}")
    st.wipe_households(DEMO_HOUSEHOLDS)      # demo households only; never touches other households
    t = now()
    with st.tx():
        name = "Casa Verde (SIMULATED)" if profile == "journey" else "Demo Household (SIMULATED)"
        for hid, nm in (("hh_demo", name), ("hh_other", "Other Household (SIMULATED)")):
            st.run("INSERT INTO households VALUES (?,?)", (hid, nm))
        for tok, (u, hid, role) in DEMO_TOKENS.items():
            st.run("INSERT INTO users VALUES (?,?,?,?)", (h(tok), u, hid, role))
        if profile == "regression":
            routines, scenarios = [F.goodnight_baseline()], F.scenarios()
            reqs = [("req-hallway-occupied", "CONFIRMED", F.req_hallway()), ("req-living-light-off", "CONFIRMED", F.req_living_off()),
                    ("req-front-door-locked", "CONFIRMED", F.req_door_locked())]
            cand = F.goodnight_faulty_candidate()
        else:
            routines, scenarios = [F.journey_goodnight_v1(), F.journey_living_welcome_v1()], F.journey_scenarios()
            reqs = F.journey_requirements()
            cand = F.journey_goodnight_candidate()
        for r in routines:
            st.run("INSERT INTO routines VALUES (?,?,?,?,?,?)", (HH, r.routine_id, r.version, json.dumps(r.model_dump(exclude_none=True)), t, "seed"))
        for sc in scenarios:
            st.run("INSERT INTO scenarios VALUES (?,?,?,?)", (HH, sc.scenario_id, sc.version, json.dumps(sc.model_dump())))
        for rid, status, spec in reqs:
            _insert_requirement(st, rid, status, spec, t)
        st.run(INSERT_CANDIDATE, ("cand-demo-faulty", HH, cand.routine_id, 1, cand.version, None, json.dumps(cand.model_dump(exclude_none=True)),
                                  None, None, "PENDING_REVIEW", "mia", t, None))
        st.audit(HH, "seed", "demo_reset", "household", HH, {"profile": profile})
    return {"household_id": HH, "candidate_id": "cand-demo-faulty", "profile": profile, "tokens": {k: v[2] for k, v in DEMO_TOKENS.items()}}
