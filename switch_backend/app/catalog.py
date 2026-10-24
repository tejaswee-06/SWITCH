"""Device catalog: the ONLY devices/capabilities the simulator can model.

Anything not listed here is rejected at validation time (never silently
treated as supported). Single global catalog for the MVP (assumption: all
households share the demo catalog).

The catalog is derived from the shared canonical home contract
(`contracts/canonical_home.json`), which is also used by the Person 3C
interpreter adapter and the frontend, so room/device identifiers cannot drift
between modules. The original six Person 2 devices (hallway_light,
living_light, bedroom_light, front_door, hallway_occupancy, bedroom_occupancy)
keep exactly the same ids, attributes and allowed values.
"""
import json
import os
from pathlib import Path
from typing import Any

_DEFAULT_CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "canonical_home.json"
CONTRACT_PATH = Path(os.getenv("SWITCH_CONTRACT_PATH", _DEFAULT_CONTRACT))

# Fallback used only if the contract file is missing (e.g. switch_backend copied on its own). It is the original
# Person 2 catalog, so the deterministic core still works; the contract test reports the missing file.
_LEGACY: dict[str, dict[str, Any]] = {
    "hallway_light":     {"type": "light",            "read_only": False, "attrs": {"power": ["on", "off"]}},
    "living_light":      {"type": "light",            "read_only": False, "attrs": {"power": ["on", "off"]}},
    "bedroom_light":     {"type": "light",            "read_only": False, "attrs": {"power": ["on", "off"]}},
    "front_door":        {"type": "lock",             "read_only": False, "attrs": {"locked": [True, False]}},
    "hallway_occupancy": {"type": "occupancy_sensor", "read_only": True,  "attrs": {"occupied": [True, False]}},
    "bedroom_occupancy": {"type": "occupancy_sensor", "read_only": True,  "attrs": {"occupied": [True, False]}},
}


def load_contract(path: Path = CONTRACT_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _build() -> tuple[dict, dict, list]:
    try:
        c = load_contract()
    except (OSError, ValueError):
        return dict(_LEGACY), {}, []
    cat = {d["device_id"]: {"type": d["type"], "read_only": bool(d["read_only"]), "attrs": d["attrs"],
                            "room": d["room_id"], "label": d["label"], "fe_id": d.get("fe_id")}
           for d in c["devices"]}
    meta = {d["device_id"]: d for d in c["devices"]}
    return cat, meta, c["rooms"]


CATALOG, DEVICE_META, ROOMS = _build()
CONTRACT_LOADED = bool(ROOMS)

SUPPORTED_CONDITION_OPS = ("eq", "neq", "time_between")
SUPPORTED_TRIGGER_TYPES = ("event", "time", "state")
SUPPORTED_BEHAVIOR_KINDS = ("must_not_set", "final_state_equals")
SUPPORTED_REPAIR_OPS = ("add_action_condition", "add_routine_condition", "remove_action", "add_action")
EVENT_KINDS = ("fire", "set")


def occupancy_sensor(room_id: str) -> str | None:
    sid = f"{room_id}_occupancy"
    return sid if sid in CATALOG else None
