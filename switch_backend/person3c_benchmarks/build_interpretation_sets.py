"""Builds the labelled correction-interpretation sets (JSONL).

LABEL PROVENANCE: statements and gold labels were hand-written by the assistant that built SWITCH Person 3C, from the
spec's schema. They are NOT independently human-annotated. `dev` was used to build/tune the rules; `test` was written
separately and scored once (see PERSON3C_IMPLEMENTATION_REPORT.md for the exact history). All text is SYNTHETIC.
"""
import json, sys
from pathlib import Path

DEV_ROOM = {"hallway_light": "hallway", "bedroom_light": "bedroom", "living_room_light": "living_room", "kitchen_light": "kitchen",
            "bathroom_light": "bathroom", "front_door_lock": "hallway", "thermostat": "living_room"}

def occ(room, v=True): return (f"{room}_occupancy", "==", v)
def mode(m): return ("mode", "==", m)
def after(t): return ("time_of_day", ">=", t)
def before(t): return ("time_of_day", "<=", t)

def R(text, device, rel, cap, val, conds=(), routine=None, cmp=None, ctx=None):
    return dict(text=text, context=ctx or {}, category="clean", gold=dict(
        decision="draft_ready", device=device, room=DEV_ROOM[device], routine=routine, scope="routine" if routine else "device",
        conditions=sorted([list(c) for c in conds if c[0] != "time_of_day"]), time=sorted([list(c) for c in conds if c[0] == "time_of_day"]),
        expected=[rel, cap, val, cmp], ambiguous=[]))

def A(text, fields, ctx=None, category="ambiguous"):
    return dict(text=text, context=ctx or {}, category=category, gold=dict(decision="needs_clarification", ambiguous=sorted(fields)))

def X(text, code):
    return dict(text=text, context={}, category="unsupported", gold=dict(decision="rejected", error_code=code))

DEV = [
 R("Don't turn off the hallway light while someone is there.", "hallway_light", "must_not_set", "power", "off", [occ("hallway")]),
 R("Never turn off the hallway light when someone is in the hallway", "hallway_light", "must_not_set", "power", "off", [occ("hallway")]),
 R("The goodnight routine must not switch off the hallway light if anyone is in the hallway.", "hallway_light", "must_not_set", "power", "off", [occ("hallway")], routine="goodnight"),
 R("Keep the kitchen light on while someone is in the kitchen", "kitchen_light", "must_not_set", "power", "off", [occ("kitchen")]),
 R("Stop turning the bathroom light off when someone is in the bathroom.", "bathroom_light", "must_not_set", "power", "off", [occ("bathroom")]),
 R("The bedroom light should stay on if somebody is in the bedroom", "bedroom_light", "must_not_set", "power", "off", [occ("bedroom")]),
 R("Don't turn on the living room light in movie mode", "living_room_light", "must_not_set", "power", "on", [mode("movie")]),
 R("Never turn on the bedroom light at night", "bedroom_light", "must_not_set", "power", "on", [mode("night")]),
 R("The hallway light should turn on when someone is in the hallway", "hallway_light", "must_set", "power", "on", [occ("hallway")]),
 R("Make sure the kitchen light turns off when nobody is in the kitchen", "kitchen_light", "must_set", "power", "off", [occ("kitchen", False)]),
 R("The living room light should be off when no one is in the living room", "living_room_light", "must_set", "power", "off", [occ("living_room", False)]),
 R("Keep the front door locked at night", "front_door_lock", "must_not_set", "lock", "unlocked", [mode("night")]),
 R("Don't unlock the front door after 10 pm", "front_door_lock", "must_not_set", "lock", "unlocked", [after("22:00")]),
 R("The front door must stay locked in away mode", "front_door_lock", "must_not_set", "lock", "unlocked", [mode("away")]),
 R("Never leave the front door unlocked when nobody is home", "front_door_lock", "must_not_set", "lock", "unlocked", [("home_occupancy", "==", False)]),
 R("The front door should lock when we're away", "front_door_lock", "must_set", "lock", "locked", [mode("away")]),
 R("Goodnight must lock the front door", "front_door_lock", "must_set", "lock", "locked", [], routine="goodnight"),
 R("Don't set the thermostat below 18 at night", "thermostat", "must_not_set", "target_temp", 18, [mode("night")], cmp="<"),
 R("Never let the thermostat go above 24 when someone is home", "thermostat", "must_not_set", "target_temp", 24, [("home_occupancy", "==", True)], cmp=">"),
 R("Keep the thermostat at 21 in the good morning routine", "thermostat", "must_set", "target_temp", 21, [], routine="good_morning"),
 R("Away mode shouldn't turn off the front door lock", "front_door_lock", "must_not_set", "lock", "locked", [], routine="away_mode") if False else R("The away mode routine must not leave the front door unlocked", "front_door_lock", "must_not_set", "lock", "unlocked", [], routine="away_mode"),
 R("Don't turn off the hallway light before 6 am", "hallway_light", "must_not_set", "power", "off", [before("06:00")]),
 R("Never switch off the bedroom light between 9 pm and 11 pm", "bedroom_light", "must_not_set", "power", "off", [after("21:00"), before("23:00")]),
 R("The movie time routine shouldn't turn on the kitchen light", "kitchen_light", "must_not_set", "power", "on", [], routine="movie_time"),
 R("In the goodnight routine the bathroom light must stay on if someone is in the bathroom", "bathroom_light", "must_not_set", "power", "off", [occ("bathroom")], routine="goodnight"),
 R("Good morning should turn on the kitchen light", "kitchen_light", "must_set", "power", "on", [], routine="good_morning"),
 R("Don't let the hallway light go off while there's someone in the hallway", "hallway_light", "must_not_set", "power", "off", [occ("hallway")]),
 R("Don't turn it off while someone's there", "hallway_light", "must_not_set", "power", "off", [occ("hallway")], ctx={"selected_device_id": "hallway_light"}),
 R("It shouldn't turn off when someone is in the room", "kitchen_light", "must_not_set", "power", "off", [occ("kitchen")], ctx={"selected_device_id": "kitchen_light"}),
 R("Do not turn off the lights in the living room if anyone is in the living room", "living_room_light", "must_not_set", "power", "off", [occ("living_room")]),
 R("Set the bedroom light brightness to 30 in the goodnight routine", "bedroom_light", "must_set", "brightness", 30, [], routine="goodnight"),
 R("Never turn off the kitchen light after 7 pm while someone is in the kitchen", "kitchen_light", "must_not_set", "power", "off", [after("19:00"), occ("kitchen")]),
 R("Away mode should switch off the living room light", "living_room_light", "must_set", "power", "off", [], routine="away_mode"),
 R("The bathroom light must not turn on at night", "bathroom_light", "must_not_set", "power", "on", [mode("night")]),
 A("The light turned off when it shouldn't have", ["device"]),
 A("Don't turn off the light while someone is there", ["device"]),
 A("Turn the lights off at some point", ["device", "expected_behavior"]) ,
 A("Fix the thing from last night", ["device", "expected_behavior"]),
 A("The hallway light is wrong", ["expected_behavior"]),
 A("Don't turn off the hallway light late", ["time"]),
 A("Keep the front door locked later on", ["time"]),
 A("Don't turn off the hallway light after 9", ["time"]),
 A("Never turn off the hallway light while someone is there but always turn it off at midnight", ["contradiction"]),
 A("Turn off the kitchen light and the bedroom light when nobody is there", ["device"]),
 A("Don't turn on or off the lights", ["device"]),
 A("Make it better", ["device", "expected_behavior"]),
 A("The door", ["expected_behavior"]),
 A("Lock stuff while we're asleep", ["device"]) if False else A("Keep things off when we sleep", ["device"]),
 A("Never turn off the light while someone is in the room", ["device"]),
 A("Keep it on", ["device"], category="ambiguous"),
 X("Order pizza when I say goodnight", "UNSUPPORTED_ACTION"),
 X("Don't open the garage door at night", "UNSUPPORTED_DEVICE"),
 X("Turn off the oven when nobody is home", "UNSUPPORTED_DEVICE"),
 X("Call me if the front door unlocks", "UNSUPPORTED_ACTION"),
 X("Don't turn off the hallway light in the party routine", "UNKNOWN_ROUTINE"),
 X("Set the hallway light brightness to 150", "INVALID_VALUE"),
 X("Set the thermostat to 45 in the goodnight routine", "INVALID_VALUE"),
 X("Make the front door lock red", "UNSUPPORTED_CAPABILITY"),
 X("Turn off the robot vacuum while someone is home", "UNSUPPORTED_DEVICE"),
 X("Send an email when the kitchen light turns on", "UNSUPPORTED_ACTION"),
 X("Keep the camera on at night", "UNSUPPORTED_DEVICE"),
 X("!!!", "INVALID_INPUT"),
 X("ok", "INVALID_INPUT"),
 X("Delete all my routines", "UNSUPPORTED_ACTION"),
 X("Don't turn off the hallway light in the dinner routine", "UNKNOWN_ROUTINE"),
 X("Play music when goodnight runs", "UNSUPPORTED_ACTION"),
]


def write(name, rows, out=Path(__file__).parent / "interpretation"):
    out.mkdir(exist_ok=True)
    with open(out / f"{name}.jsonl", "w") as f:
        for i, r in enumerate(rows, 1):
            f.write(json.dumps({"id": f"{name}_{i:03d}", "split": name, "label_source": "hand-written by assistant; SYNTHETIC; not independent human annotation", **r}) + "\n")


if __name__ == "__main__":
    write("dev", DEV)
    try:
        from test_cases import TEST  # noqa  (kept in a separate file, written after rules froze)
        write("test", TEST)
    except ImportError:
        pass
    try:
        from test2_cases import TEST2  # noqa
        write("test2_blind", TEST2)
    except ImportError:
        pass
    print("wrote", len(DEV), "dev cases")
