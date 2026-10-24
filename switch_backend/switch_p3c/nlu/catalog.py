"""Household catalog used to validate interpretations and repairs.

SYNTHETIC LOCAL FIXTURE (provenance=local_fixture). Replace by Person 2's canonical room/device/routine registry
when it is available; the interpreter only depends on the `Catalog` interface below.
"""
from __future__ import annotations
from dataclasses import dataclass, field

BOOL = {"on", "off"}


@dataclass
class DeviceSpec:
    device_id: str
    room: str
    kind: str
    capabilities: dict  # capability -> list of allowed enum values | ("int", lo, hi)


@dataclass
class Catalog:
    household_id: str
    rooms: list[str]
    devices: dict[str, DeviceSpec]
    routines: dict[str, str]          # routine_id -> display name
    signals: dict[str, object]        # signal -> enum list | "bool" | ("time",)
    provenance: str = "local_fixture"
    aliases: dict = field(default_factory=dict)

    def device(self, did: str) -> DeviceSpec | None:
        return self.devices.get(did)

    def valid_value(self, device_id: str, capability: str, value) -> bool:
        d = self.devices.get(device_id)
        if not d or capability not in d.capabilities:
            return False
        spec = d.capabilities[capability]
        if isinstance(spec, tuple) and spec[0] == "int":
            return isinstance(value, (int, float)) and not isinstance(value, bool) and spec[1] <= value <= spec[2]
        return value in spec

    def valid_signal(self, signal: str) -> bool:
        return signal in self.signals


def demo_catalog(household_id: str = "hh_demo") -> Catalog:
    rooms = ["hallway", "bedroom", "living_room", "kitchen", "bathroom"]
    devs = {f"{r}_light": DeviceSpec(f"{r}_light", r, "light", {"power": ["on", "off"], "brightness": ("int", 0, 100)}) for r in rooms}
    devs["front_door_lock"] = DeviceSpec("front_door_lock", "hallway", "lock", {"lock": ["locked", "unlocked"]})
    devs["thermostat"] = DeviceSpec("thermostat", "living_room", "thermostat", {"target_temp": ("int", 10, 30), "mode": ["heat", "cool", "off"]})
    sig = {f"{r}_occupancy": "bool" for r in rooms}
    sig["home_occupancy"] = "bool"
    sig["mode"] = ["home", "away", "night", "movie"]
    sig["time_of_day"] = ("time",)
    sig["front_door_state"] = ["open", "closed"]
    return Catalog(household_id, rooms, devs,
                   {"goodnight": "Goodnight", "good_morning": "Good morning", "away_mode": "Away mode", "movie_time": "Movie time"}, sig)
