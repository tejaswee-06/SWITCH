"""Labelled SYNTHETIC fixtures for the SIMULATED DEMO and the regression benchmark."""
from .schemas import Routine, Scenario, RequirementContent

OCC_FALSE = {"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": False}
OCC_TRUE = {"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": True}


def goodnight_baseline() -> Routine:
    return Routine.model_validate({
        "routine_id": "goodnight", "version": 1, "name": "Goodnight", "priority": 100,
        "triggers": [{"type": "event", "name": "goodnight"}],
        "actions": [
            {"action_id": "a1", "device": "hallway_light", "attr": "power", "value": "off", "conditions": [OCC_FALSE]},
            {"action_id": "a2", "device": "living_light", "attr": "power", "value": "off"},
            {"action_id": "a3", "device": "front_door", "attr": "locked", "value": True},
        ]})


def goodnight_faulty_candidate() -> Routine:
    r = goodnight_baseline().model_copy(deep=True)
    r.version = 2
    r.actions[0].conditions = []          # the occupancy guard was accidentally removed
    return r


def _sc(sid, desc, occupied, extra_events=None, version=1):
    return Scenario.model_validate({
        "scenario_id": sid, "version": version, "description": desc, "seed": 0, "start": "22:00", "end": "23:59",
        "initial_state": {"hallway_occupancy": {"occupied": occupied}, "hallway_light": {"power": "on"},
                          "living_light": {"power": "on"}, "front_door": {"locked": False}},
        "events": [{"event_id": "ev1", "at": "22:30", "kind": "fire", "name": "goodnight"}] + (extra_events or [])})


def scenarios() -> list[Scenario]:
    return [_sc("sc-hallway-occupied", "SYNTHETIC: someone is in the hallway at Goodnight", True),
            _sc("sc-hallway-unknown", "SYNTHETIC: hallway occupancy sensor reports unknown", None)]


def req_hallway() -> RequirementContent:
    return RequirementContent.model_validate({
        "title": "Do not turn off the hallway light while someone is there",
        "source_correction": "Don't turn off the hallway light while someone is there.",
        "scope": {"routine_ids": ["goodnight"], "devices": ["hallway_light"], "scenario_ids": ["sc-hallway-occupied"]},
        "preconditions": [OCC_TRUE],
        "expected_behavior": {"kind": "must_not_set", "device": "hallway_light", "attr": "power", "value": "off"},
        "interpreter": "seed_fixture"})


def req_living_off() -> RequirementContent:
    return RequirementContent.model_validate({
        "title": "Goodnight leaves the living room light off",
        "source_correction": "Goodnight should switch off the living room light.",
        "scope": {"routine_ids": ["goodnight"], "devices": ["living_light"], "scenario_ids": ["sc-hallway-occupied"]},
        "expected_behavior": {"kind": "final_state_equals", "device": "living_light", "attr": "power", "value": "off"},
        "interpreter": "seed_fixture"})


def req_door_locked() -> RequirementContent:
    return RequirementContent.model_validate({
        "title": "Goodnight locks the front door",
        "source_correction": "Make sure the front door is locked at night.",
        "scope": {"routine_ids": ["goodnight"], "devices": ["front_door"], "scenario_ids": ["sc-hallway-occupied"]},
        "expected_behavior": {"kind": "final_state_equals", "device": "front_door", "attr": "locked", "value": True},
        "interpreter": "seed_fixture"})


# ---------------------------------------------------------------------------------------------------------------
# "journey" profile: the product demo household (Casa Verde). Mirrors the routine shown in the 3D house:
# Goodnight switches off living/kitchen/hallway lights and the TV, and arms the security system. The live
# version (v1) already contains the household's earlier hallway correction ("unless the hallway is occupied");
# the pending candidate (v2) is a later edit that accidentally drops it. The hallway requirement itself is NOT
# seeded: the demo creates it from the user's correction, then the user confirms it.
# ---------------------------------------------------------------------------------------------------------------
HALL_OCC_FALSE = {"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": False}


def journey_goodnight_v1() -> Routine:
    return Routine.model_validate({
        "routine_id": "goodnight", "version": 1, "name": "Goodnight", "priority": 100,
        "description": "Live Goodnight. Includes the household's earlier correction: the hallway light stays on while the hallway is occupied.",
        "triggers": [{"type": "event", "name": "goodnight"}],
        "actions": [
            {"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"},
            {"action_id": "a2", "device": "kitchen_light", "attr": "power", "value": "off"},
            {"action_id": "a3", "device": "hallway_light", "attr": "power", "value": "off", "conditions": [HALL_OCC_FALSE]},
            {"action_id": "a4", "device": "tv", "attr": "power", "value": "off"},
            {"action_id": "a5", "device": "security", "attr": "armed", "value": True},
        ]})


def journey_goodnight_candidate() -> Routine:
    r = journey_goodnight_v1().model_copy(deep=True)
    r.version = 2
    r.description = "Household edit: simplified Goodnight. The hallway occupancy condition was removed."
    r.actions[2].conditions = []          # the occupancy guard was accidentally removed again
    return r


def journey_living_welcome_v1() -> Routine:
    return Routine.model_validate({
        "routine_id": "living_welcome", "version": 1, "name": "Living room welcome", "priority": 200,
        "description": "Turns the living-room lights on when someone enters the living room.",
        "triggers": [{"type": "state", "device": "living_occupancy", "attr": "occupied", "value": True}],
        "actions": [{"action_id": "a1", "device": "living_light", "attr": "power", "value": "on"}]})


def _jsc(sid, desc, hallway, edge=False):
    occ = {f"{r}_occupancy": {"occupied": False} for r in ("living", "kitchen", "bedroom", "bedroom2", "bedroom3", "bathroom", "patio")}
    occ["hallway_occupancy"] = {"occupied": hallway if hallway is not True else False}
    events = []
    if hallway is True:      # someone walks into the hallway shortly before Goodnight runs
        events.append({"event_id": "ev0", "at": "22:25", "kind": "set", "device": "hallway_occupancy", "attr": "occupied", "value": True})
    events.append({"event_id": "ev1", "at": "22:30", "kind": "fire", "name": "goodnight"})
    return Scenario.model_validate({
        "scenario_id": sid, "version": 1, "description": desc, "seed": 0, "start": "22:00", "end": "23:59", "edge_case": edge,
        "initial_state": {**occ, "living_light": {"power": "on"}, "kitchen_light": {"power": "on"}, "hallway_light": {"power": "on"},
                          "tv": {"power": "on"}, "security": {"armed": False}},
        "events": events})


def journey_scenarios() -> list[Scenario]:
    return [_jsc("sc-hallway-occupied", "SYNTHETIC: someone walks into the hallway at 22:25; Goodnight runs at 22:30", True),
            _jsc("sc-house-empty", "SYNTHETIC: nobody is in any room when Goodnight runs at 22:30", False),
            _jsc("sc-hallway-sensor-offline", "SYNTHETIC EDGE CASE: the hallway occupancy sensor is offline (state UNKNOWN)", None, edge=True)]


_GN_SCEN = ["sc-hallway-occupied", "sc-house-empty"]


def journey_requirements() -> list[tuple[str, str, RequirementContent]]:
    """(requirement_id, status, content)."""
    return [
        ("req-living-light-off", "CONFIRMED", RequirementContent.model_validate({
            "title": "Living room lights are off after Goodnight",
            "source_correction": "Make sure the living room lights are off after Goodnight.",
            "scope": {"routine_ids": ["goodnight"], "devices": ["living_light"], "scenario_ids": _GN_SCEN},
            "expected_behavior": {"kind": "final_state_equals", "device": "living_light", "attr": "power", "value": "off"},
            "interpreter": "seed_fixture"})),
        ("req-security-armed", "CONFIRMED", RequirementContent.model_validate({
            "title": "Security system is armed after Goodnight",
            "source_correction": "Make sure the security system is armed after Goodnight.",
            "scope": {"routine_ids": ["goodnight"], "devices": ["security"], "scenario_ids": _GN_SCEN},
            "expected_behavior": {"kind": "final_state_equals", "device": "security", "attr": "armed", "value": True},
            "interpreter": "seed_fixture"})),
        ("req-bathroom-light-on", "DISABLED", RequirementContent.model_validate({
            "title": "Bathroom light is not switched off by Goodnight",
            "source_correction": "Leave the bathroom light alone at night.",
            "scope": {"routine_ids": ["goodnight"], "devices": ["bathroom_light"], "scenario_ids": _GN_SCEN},
            "expected_behavior": {"kind": "must_not_set", "device": "bathroom_light", "attr": "power", "value": "off"},
            "interpreter": "seed_fixture"})),
    ]
