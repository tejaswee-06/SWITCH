"""Correction interpretation: natural language -> schema-validated DRAFT requirement (+ clarification).

Deterministic rules are the always-available fallback. An optional LLM provider may propose a structured draft;
its output is schema- and catalog-validated, cross-checked against the rules, and never trusted on confidence alone.
Nothing here can produce PASS/FAIL/INCONCLUSIVE, and nothing here confirms a draft without explicit user confirmation.
"""
from __future__ import annotations
import re
from typing import Any, Optional

from pydantic import ValidationError

from ..contracts import (Ambiguity, Condition, ConfirmedRequirement, Confirmation, ExpectedBehavior, InterpretRequest,
                         InterpretationProvenance, P3CError, RequirementDraft, Scope, now_iso)
from .catalog import Catalog

NEG = r"\b(?:don'?t|do not|never|shouldn'?t|should not|shall not|must not|mustn'?t|stop|avoid|can'?t|cannot|no more|nobody should|no one should|not allowed|not supposed|isn'?t allowed)\b"
OFF_VERB = r"(?:turn(?:ing)?|switch(?:ing)?|shut(?:ting)?|power(?:ing)?)\s+(?:it\s+|them\s+|the\s+[\w\s]*?)?(?:off|out|down)"
ROOM_WORDS = {"hallway": "hallway", "hall": "hallway", "corridor": "hallway", "bedroom": "bedroom", "living room": "living_room",
              "lounge": "living_room", "kitchen": "kitchen", "bathroom": "bathroom", "bath": "bathroom", "toilet": "bathroom",
              # canonical-villa rooms (resolved through Catalog.aliases["rooms"]; absent from the P3C demo fixture catalog)
              "bedroom 1": "bedroom", "bedroom one": "bedroom", "main bedroom": "bedroom",
              "bedroom 2": "bedroom2", "bedroom two": "bedroom2", "second bedroom": "bedroom2",
              "bedroom 3": "bedroom3", "bedroom three": "bedroom3", "third bedroom": "bedroom3", "upstairs bedroom": "bedroom3",
              "patio": "patio", "terrace": "patio", "rooftop terrace": "patio"}
ROUTINE_WORDS = {"goodnight": "goodnight", "good night": "goodnight", "bedtime": "goodnight", "good morning": "good_morning",
                 "morning routine": "good_morning", "wake up": "good_morning", "away": "away_mode", "movie": "movie_time"}
UNSUPPORTED_DEVICE_WORDS = ["garage", "camera", "alarm", "oven", "stove", "vacuum", "robot", "tv", "television", "speaker", "blind", "curtain",
                            "sprinkler", "fridge", "washing machine", "dishwasher", "heater", "fan", "kettle", "coffee", "window", "siren", "doorbell", "fireplace"]
UNSUPPORTED_ACTION_WORDS = ["call", "text", "email", "order", "buy", "delete", "erase", "send", "notify", "play", "record", "unlock everything",
                            "disable the alarm", "open the", "post", "purchase", "book", "dial", "shut down the"]
VAGUE_TIME = ["late", "early", "later", "soon", "sometimes", "usually", "in a while", "most nights", "evening", "morning", "afternoon", "daytime"]


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", t.lower().replace("’", "'")).strip()


def _t24(h: str, m: Optional[str], ap: Optional[str]) -> Optional[str]:
    hh, mm = int(h), int(m or 0)
    if ap:
        if hh < 1 or hh > 12:
            return None
        hh = hh % 12 + (12 if ap.lower() == "pm" else 0)
    if hh > 23 or mm > 59:
        return None
    return f"{hh:02d}:{mm:02d}"


# ---------------------------------------------------------------- deterministic extraction
_ACTIVE_CAT: list = []   # catalog of the current interpret() call (room aliases); empty => identity mapping


def _room(r: Optional[str]) -> Optional[str]:
    """Map an interpreter room word to the catalog's room id (e.g. living_room -> living in the canonical villa)."""
    if r is None or not _ACTIVE_CAT:
        return r
    return _ACTIVE_CAT[-1].aliases.get("rooms", {}).get(r, r)


def _find_rooms(t: str) -> list[str]:
    """Longest room words first; a matched span is consumed so 'bedroom 2' does not also yield 'bedroom'."""
    found, taken = [], []
    for w, r in sorted(ROOM_WORDS.items(), key=lambda kv: -len(kv[0])):
        for m in re.finditer(rf"\b{re.escape(w)}\b", t):
            if any(m.start() < b and a < m.end() for a, b in taken):
                continue
            taken.append((m.start(), m.end()))
            rr = _room(r)
            if rr not in found:
                found.append(rr)
    return found


def _kind_device(cat: Catalog, kind: str) -> Optional[str]:
    return next((d for d, spec in cat.devices.items() if spec.kind == kind), None)


def _device_terms(cat: Catalog) -> dict:
    return cat.aliases.get("device_terms", {})


def _find_devices(t: str, cat: Catalog, ctx: dict, used: list[str]) -> tuple[list[str], list[Ambiguity]]:
    amb: list[Ambiguity] = []
    devs: list[str] = []
    lock = _kind_device(cat, "lock")
    if re.search(r"\b(front )?door( lock)?\b|\block(?:ed|s)?\b|\bunlock", t) and lock:
        devs.append(lock)
    if re.search(r"\bthermostat\b|\btemperature\b|\bheating\b|\bheat\b|\bac\b|\bair con", t):
        thermo = _kind_device(cat, "thermostat")
        if not thermo:
            raise P3CError("UNSUPPORTED_DEVICE", "temperature / thermostat requirements are not modeled in this household",
                           {"term": "thermostat", "supported": sorted(cat.devices)})
        devs.append(thermo)
    for term, did in sorted(_device_terms(cat).items(), key=lambda kv: -len(kv[0])):
        if did in cat.devices and re.search(rf"\b{re.escape(term)}\b", t):
            devs.append(did)
    if re.search(r"\blights?\b|\blamp\b", t):
        rooms = _find_rooms(t)
        # room explicitly attached to the light word, e.g. "hallway light", "light in the kitchen"
        attached, taken = [], []
        for w, r in sorted(ROOM_WORDS.items(), key=lambda kv: -len(kv[0])):
            pat = rf"\b{re.escape(w)}\s+(?:ceiling\s+)?(?:lights?|lamp)\b|\b(?:lights?|lamp)s?\s+(?:in|of|at)\s+the\s+{re.escape(w)}\b"
            for m in re.finditer(pat, t):
                if any(m.start() < b and a < m.end() for a, b in taken):
                    continue   # "bedroom 2 light" must not also attach "bedroom"
                taken.append((m.start(), m.end()))
                rr = _room(r)
                if rr not in attached:
                    attached.append(rr)
        if attached:
            devs += [f"{r}_light" for r in attached if f"{r}_light" in cat.devices]
        elif len(rooms) == 1 and f"{rooms[0]}_light" in cat.devices and not re.search(r"\b(all|every|whole house|everywhere)\b", t):
            devs.append(f"{rooms[0]}_light")
            used.append("room-as-device")
        elif ctx.get("selected_device_id") in cat.devices and cat.devices[ctx["selected_device_id"]].kind == "light":
            devs.append(ctx["selected_device_id"]); used.append("selected_device_id")
        else:
            opts = [d for d in cat.devices if cat.devices[d].kind == "light"]
            amb.append(Ambiguity(field="device", reason="light mentioned without a specific room", question="Which light do you mean?", options=opts))
    if not devs and not amb:
        if re.search(r"\b(it|that|this|them)\b", t) and ctx.get("selected_device_id") in cat.devices:
            devs.append(ctx["selected_device_id"]); used.append("selected_device_id")
    return list(dict.fromkeys(devs)), amb


def _find_routine(t: str, cat: Catalog, ctx: dict, used: list[str]):
    for w, rid in sorted(ROUTINE_WORDS.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(w)}\b(?:\s+(?:routine|mode|scene|automation|schedule))?", t):
            if w == "away" and not re.search(r"\baway\s+(?:mode\s+)?(routine|scene|automation)\b|\baway mode\s+(?:should|must|shouldn'?t|will|needs)\b", t):
                continue
            if w == "movie" and not re.search(r"\bmovie\s+(routine|scene|time|automation)\b", t):
                continue
            if rid in cat.routines:
                return rid, None
    m = re.search(r"\b(?:in|during|from|by)\s+(?:the\s+)?([a-z ]{2,20}?)\s+(routine|scene|automation)\b", t)
    if m and not any(w in m.group(1) for w in ROUTINE_WORDS):
        return None, m.group(1).strip()
    if re.search(r"\b(the routine|that routine|this routine)\b", t) and ctx.get("selected_routine_id") in cat.routines:
        used.append("selected_routine_id")
        return ctx["selected_routine_id"], None
    return None, None


def _find_conditions(t: str, cat: Catalog, device_room: Optional[str]) -> tuple[list[Condition], list[Ambiguity]]:
    conds: list[Condition] = []
    amb: list[Ambiguity] = []
    # occupancy: positive
    away_first = re.search(r"\b(?:while|when|if|whenever|once)\s+(?:we(?:'re| are)|i(?:'m| am)|everyone(?:'s| is| has)?|they(?:'re| are))\s+(?:all\s+)?(?:away|out|gone|not home|out of the house)\b", t)
    pos = re.search(r"\b(?:while|when|if|as long as|whenever|whilst|so long as)\s+(?:there'?s |there is )?(?:someone|anyone|somebody|anybody|people|a person|we are|we're|i am|i'm|they are|they're|the kids are)\s*(?:is |are )?(?:still )?(in|at|inside|there|home|present|up|around|in the)?\b(?:\s+(?:the\s+)?(hallway|hall|corridor|bedroom|living room|lounge|kitchen|bathroom|bath|toilet))?", t)
    activity = re.search(r"\bwhile\s+(?:i|we|someone|somebody|they)\s+(?:was|were|am|are|is|'m|'re)\s+(?:still\s+)?(?:standing|sitting|working|cooking|sleeping|showering|reading|watching|there|in)\b", t)
    neg = re.search(r"\b(?:while|when|if|whenever|once)\s+(?:nobody|no one|no-one|noone|nobody's|the house is empty|the room is empty|everyone has left|everyone is gone|everyone's gone|we are all out|we're all out|nobody is)", t)
    away_home = re.search(r"\bwhen (?:we(?:'re| are) )?(?:out|away from home|not home)\b", t)
    if away_first:
        conds.append(Condition(signal="mode", op="==", value="away"))
    elif activity and not neg and not pos:
        rr = _find_rooms(t[activity.end():])
        room = (rr[0] if rr else None) or device_room
        if room is None:
            amb.append(Ambiguity(field="room", reason="occupancy condition has no room", question="Occupancy in which room?", options=cat.rooms))
        else:
            conds.append(Condition(signal=f"{room}_occupancy", op="==", value=True))
    elif pos and not neg:
        room = _room(ROOM_WORDS.get(pos.group(2))) if pos.group(2) else None
        if room is None:
            tail = t[pos.end():pos.end() + 25]
            r2 = _find_rooms(tail)
            room = r2[0] if r2 else None
        if room is None and pos.group(1) == "home" or (room is None and re.search(r"\bsomeone(?:'s)? (?:is )?home\b|\banyone (?:is )?home\b|\bsomebody (?:is )?home\b", t)):
            conds.append(Condition(signal="home_occupancy", op="==", value=True))
        else:
            room = room or device_room
            if room is None:
                amb.append(Ambiguity(field="room", reason="occupancy condition has no room", question="Occupancy in which room?", options=cat.rooms))
            else:
                conds.append(Condition(signal=f"{room}_occupancy", op="==", value=True))
    elif neg:
        rr = _find_rooms(t[neg.start():])
        room = rr[0] if rr else device_room
        if not rr and re.search(r"\b(house is empty|everyone has left|everyone is gone|everyone's gone|we are all out|we're all out|home|house)\b", t[neg.start():]):
            conds.append(Condition(signal="home_occupancy", op="==", value=False))
        elif room is None:
            conds.append(Condition(signal="home_occupancy", op="==", value=False))
        else:
            conds.append(Condition(signal=f"{room}_occupancy", op="==", value=False))
    elif away_home:
        conds.append(Condition(signal="mode", op="==", value="away"))
    # mode
    mm = re.search(r"\b(?:in|during|when in|while in)\s+(away|night|movie|home)\s+mode\b(?!\s+(?:routine|scene|automation))", t)
    if mm and not any(c.signal == "mode" for c in conds):
        conds.append(Condition(signal="mode", op="==", value=mm.group(1)))
    elif re.search(r"\b(?:at night|overnight|at bedtime|during the night|through the night|all night)\b", t):
        conds.append(Condition(signal="mode", op="==", value="night"))
    # explicit clock times
    ck = r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?"
    between = re.search(rf"\bbetween\s+{ck}\s+and\s+{ck}", t)
    if between:
        g = between.groups()
        a = _t24(g[0], g[1], (g[2] or "").replace(".", "") or None); b = _t24(g[3], g[4], (g[5] or "").replace(".", "") or None)
        if a and b:
            conds += [Condition(signal="time_of_day", op=">=", value=a), Condition(signal="time_of_day", op="<=", value=b)]
        else:
            amb.append(Ambiguity(field="time", reason="invalid clock time", question="What time range do you mean?"))
    else:
        for word, op in (("after", ">="), ("past", ">="), ("from", ">="), ("before", "<="), ("until", "<="), ("by", "<=")):
            for m in re.finditer(rf"\b{word}\s+{ck}", t):
                g = m.groups()
                ap = (g[2] or "").replace(".", "") or None
                if not ap and not g[1] and int(g[0]) <= 12 and word != "from":
                    amb.append(Ambiguity(field="time", reason="clock time without am/pm", question=f"Is {g[0]} am or pm?", options=["am", "pm"]))
                    continue
                tv = _t24(g[0], g[1], ap)
                if tv is None:
                    amb.append(Ambiguity(field="time", reason="invalid clock time", question="What time do you mean?"))
                elif not (word == "by" and not re.search(r"\bby\s+\d", t)):
                    conds.append(Condition(signal="time_of_day", op=op, value=tv))
    t_nr = re.sub(r"good\s*morning|good\s*night|goodnight|morning routine", " ", t)
    if not any(c.signal in ("time_of_day",) for c in conds) and not any(a.field == "time" for a in amb):
        if any(re.search(rf"\b{w}\b", t_nr) for w in VAGUE_TIME) and not any(c.signal == "mode" for c in conds):
            amb.append(Ambiguity(field="time", reason="vague time reference", question="What exact time or mode should this apply to?",
                                 options=["night mode", "a clock time"]))
    return conds, amb


def _clause_behavior(c: str, devices: list[str], cat: Catalog):
    """Return (capability, relation, value, comparator) or None for one clause."""
    ne = re.search(NEG, c) is not None
    # thermostat
    if "thermostat" in devices or re.search(r"\b(temperature|thermostat|heating)\b", c):
        m = re.search(r"\b(?:below|under|less than|lower than)\s+(\d{1,2})", c)
        if m and ne:
            return "target_temp", "must_not_set", int(m.group(1)), "<"
        m = re.search(r"\b(?:above|over|higher than|more than)\s+(\d{1,2})", c)
        if m and ne:
            return "target_temp", "must_not_set", int(m.group(1)), ">"
        m = re.search(r"\b(?:at|to)\s+(\d{1,2})\b", c)
        if m and re.search(r"\b(keep|stay|hold|leave|set|should be|must be|make sure)\b", c) and not ne:
            return "target_temp", "must_set", int(m.group(1)), None
        if re.search(r"\b(keep|stay|leave)\b.*\b(off)\b", c):
            return "mode", "must_remain", "off", None
    # security system (armed / disarmed) - only when the catalog models one
    if any(cat.devices[d].kind == "security" for d in devices if d in cat.devices):
        if ne and re.search(r"\bdisarm", c):
            return "armed", "must_not_set", "disarmed", None
        if ne and re.search(r"\barm(?:ed)?\b", c):
            return "armed", "must_not_set", "armed", None
        if re.search(r"\b(keep|stay|stays|remain|leave|kept)\b.{0,30}\barmed\b", c):
            return "armed", "must_not_set", "disarmed", None
        if re.search(r"\bdisarmed\b", c):
            return "armed", "must_set", "disarmed", None
        if re.search(r"\barmed\b|\barm\b", c):
            return "armed", "must_set", "armed", None
    # lock
    if any(cat.devices[d].kind == "lock" for d in devices if d in cat.devices) or re.search(r"\block(ed|s)?\b|\bunlock", c):
        if ne and re.search(r"unlock", c):
            return "lock", "must_not_set", "unlocked", None
        if ne and re.search(r"\block\b", c) and not re.search(r"\blocked\b", c):
            return "lock", "must_not_set", "locked", None
        if re.search(r"\b(keep|stay|stays|remain|leave|be|kept)\b.{0,30}\blocked\b", c):
            return "lock", "must_not_set", "unlocked", None
        if re.search(r"\b(should|must|needs? to|make sure|has to|always|ought to|will)\b.{0,25}\bunlock", c):
            return "lock", "must_set", "unlocked", None
        if re.search(r"\b(should|must|needs? to|make sure|has to|always|ought to|will)\b.{0,25}\block\b|\block\b.{0,25}\b(automatically|when|after)\b", c):
            return "lock", "must_set", "locked", None
    # lights / power (state-word based: negation / keep-stay / must-be decide the relation)
    verbs = r"(?:turn\w*|switch\w*|shut\w*|power\w*|go|goes|going|gone|went|get|gets|got|come|comes|came|be|stay\w*|remain\w*|keep\w*|kept|leave|leaves|left|let|drop\w*|dim\w*)"
    st_off = re.search(rf"\b{verbs}\b.{{0,35}}?\b(?:off|out)\b|\b(?:off|out)\b", c)
    st_on = re.search(rf"\b{verbs}\b.{{0,35}}?\bon\b", c)
    keepish = re.search(r"\b(?:keep\w*|kept|stay\w*|remain\w*|leave|leaves|left|hold)\b", c)
    complaint = re.search(r"\b(?:shouldn'?t|should not|wasn'?t supposed|wasn'?t meant|hate|hated|annoy\w*|wrong|bad|don'?t like|dislike)\b", c)
    went = re.search(r"\b(?:went|gone|turned|switched|came|got)\b", c)
    state = None
    if st_off and not (st_on and st_on.start() < st_off.start()):
        state = "off"
    elif st_on:
        state = "on"
    if state:
        if ne:
            return "power", "must_not_set", state, None
        if went and complaint and not re.search(r"\b(?:make sure|should|must|always)\b.{0,15}\b(turn|come|go)", c):
            return "power", "must_not_set", state, None
        if keepish:
            return "power", "must_not_set", ("on" if state == "off" else "off"), None
        if re.search(r"\b(?:should|must|needs? to|has to|have to|make sure|always|ought to|will|shall|turns?|comes?|goes?)\b", c) or re.search(r"\b(?:turn|switch|shut|power)\w*\b", c):
            return "power", "must_set", state, None
        if re.search(r"\b(?:be|is)\b", c):
            return "power", "must_set", state, None
    m = re.search(r"\bbrightness\b.*?\b(\d{1,3})\s*%?", c)
    if m:
        v = int(m.group(1))
        return "brightness", "must_set", v, None
    return None


def deterministic_interpret(req: InterpretRequest, cat: Catalog) -> RequirementDraft:
    text = req.text.strip()
    t = _norm(text)
    ctx = req.context or {}
    used: list[str] = []
    if len(re.findall(r"[a-z]", t)) < 4:
        raise P3CError("INVALID_INPUT", "correction text is too short or not language", {"text_len": len(text)})
    # unsupported vocabulary => reject (not a draft)
    supported_terms = set(_device_terms(cat))
    for w in UNSUPPORTED_DEVICE_WORDS:
        if w in supported_terms:
            continue
        if re.search(rf"\b{re.escape(w)}s?\b", t):
            raise P3CError("UNSUPPORTED_DEVICE", f"'{w}' is not a device SWITCH can model in this household", {"term": w, "supported": sorted(cat.devices)})
    for w in UNSUPPORTED_ACTION_WORDS:
        if re.search(rf"\b{re.escape(w)}\b", t):
            raise P3CError("UNSUPPORTED_ACTION", f"'{w}' is not a supported requirement action", {"term": w})
    if re.search(r"\b(color|colour|red|blue|green|dim(?:mer)?)\b", t) and re.search(r"\b(lock|thermostat|door)\b", t):
        raise P3CError("UNSUPPORTED_CAPABILITY", "requested capability is not supported by that device", {})
    m = re.search(r"\bbrightness\b.*?(\d{1,3})\s*%?", t)
    if m and int(m.group(1)) > 100:
        raise P3CError("INVALID_VALUE", "brightness must be between 0 and 100", {"value": int(m.group(1))})
    m = re.search(r"\b(?:thermostat|temperature|heating)\b.*?\b(\d{1,3})\b", t)
    if m and not (10 <= int(m.group(1)) <= 30) and re.search(r"\b(at|to|below|above|under|over)\s+" + m.group(1), t):
        raise P3CError("INVALID_VALUE", "thermostat target must be between 10 and 30 °C", {"value": int(m.group(1))})

    routine_id, unknown_routine = _find_routine(t, cat, ctx, used)
    if unknown_routine:
        raise P3CError("UNKNOWN_ROUTINE", f"routine '{unknown_routine}' is not in this household", {"known": sorted(cat.routines)})
    devices, amb = _find_devices(t, cat, ctx, used)
    # clause split for contradiction detection
    clauses = [c for c in re.split(r"\s+(?:but|yet|however)\s+|\s+and\s+(?=(?:never|always|don'?t|do not|keep|turn|switch|stop)\b)|;|\.\s+", t) if c.strip()]
    behaviors = []
    for c in clauses:
        b = _clause_behavior(c, devices, cat)
        if b:
            behaviors.append(b)
    behavior = behaviors[0] if behaviors else None
    if len(behaviors) > 1 and any(b[0] == behaviors[0][0] and b[2] == behaviors[0][2] and b[1] != behaviors[0][1] for b in behaviors[1:]):
        amb.append(Ambiguity(field="contradiction", reason="statement contains opposite requirements for the same device state",
                             question="Should the device be allowed to change to that state or not?"))
    elif len(behaviors) > 1 and any(b[0] == behaviors[0][0] and b[1] == behaviors[0][1] and b[2] != behaviors[0][2] and b[3] is None and behaviors[0][3] is None and b[0] != "target_temp" for b in behaviors[1:]):
        amb.append(Ambiguity(field="contradiction", reason="statement requires two different values", question="Which value should be required?"))
    if len(devices) > 1:
        amb.append(Ambiguity(field="device", reason="several devices mentioned", question="Which device should this requirement cover?", options=devices))
        target = None
    else:
        target = devices[0] if devices else None
    if not devices and not any(a.field == "device" for a in amb):
        amb.append(Ambiguity(field="device", reason="no device identified", question="Which device does this correction concern?", options=sorted(cat.devices)))
    device_room = cat.devices[target].room if target else None
    conds, c_amb = _find_conditions(t, cat, device_room)
    if any(a.field == "device" for a in amb):
        c_amb = [a for a in c_amb if a.field != "room"]  # asking which device already resolves the room
    amb += c_amb
    expected = None
    if behavior is None:
        amb.append(Ambiguity(field="expected_behavior", reason="could not tell what the device must or must not do", question="What should (or should not) happen to the device?"))
    elif target:
        cap, rel, val, cmp_ = behavior
        if target and cat.valid_value(target, cap, val) or (cmp_ and cap in cat.devices[target].capabilities):
            expected = ExpectedBehavior(device_id=target, capability=cap, relation=rel, value=val, comparator=cmp_)
        else:
            raise P3CError("UNSUPPORTED_CAPABILITY", f"{target} does not support {cap}={val}", {"device": target, "capability": cap})
    # scope
    if routine_id:
        scope = Scope(kind="routine", id=routine_id)
    elif target:
        scope = Scope(kind="device", id=target)
    elif devices:
        scope = Scope(kind="household")
    else:
        scope = Scope(kind="household")
    room = device_room
    filled = sum([bool(target), bool(expected), True, True])
    conf = max(0.0, min(1.0, 0.25 * filled - 0.15 * len(amb)))
    title = _title(expected, conds, routine_id)
    d = RequirementDraft(
        household_id=req.household_id, title=title, source_correction=text, scope=scope, preconditions=conds, expected_behavior=expected,
        ambiguities=amb, needs_clarification=bool(amb), room=room,
        provenance=InterpretationProvenance(interpreter="deterministic_rules", heuristic_confidence=round(conf, 2), context_used=used))
    return d


def _title(e: Optional[ExpectedBehavior], conds: list[Condition], routine_id: Optional[str]) -> str:
    if not e:
        return "Unresolved correction (needs clarification)"
    verb = {"must_not_set": "Do not set", "must_set": "Set", "must_remain": "Keep"}[e.relation]
    s = f"{verb} {e.device_id} {e.capability} {'' if not e.comparator else e.comparator}{e.value}".replace("  ", " ")
    if conds:
        s += " when " + " and ".join(f"{c.signal}{c.op}{c.value}" for c in conds)
    if routine_id:
        s += f" in {routine_id}"
    return s[:140]


# ---------------------------------------------------------------- catalog validation (shared by rules + LLM path)
def validate_against_catalog(d: RequirementDraft, cat: Catalog) -> list[str]:
    errs = []
    if d.household_id != cat.household_id:
        errs.append("household_id mismatch")
    e = d.expected_behavior
    if e:
        if e.device_id not in cat.devices:
            errs.append(f"unknown device {e.device_id}")
        elif e.capability not in cat.devices[e.device_id].capabilities:
            errs.append(f"unsupported capability {e.capability}")
        elif not e.comparator and not cat.valid_value(e.device_id, e.capability, e.value):
            errs.append(f"invalid value {e.value} for {e.capability}")
    for c in d.preconditions:
        if not cat.valid_signal(c.signal):
            errs.append(f"unknown signal {c.signal}")
        else:
            spec = cat.signals[c.signal]
            if spec == "bool" and not isinstance(c.value, bool):
                errs.append(f"signal {c.signal} expects boolean")
            elif isinstance(spec, list) and c.value not in spec:
                errs.append(f"signal {c.signal} value {c.value} not in {spec}")
            elif isinstance(spec, tuple) and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(c.value)):
                errs.append("time_of_day must be HH:MM")
    if d.scope.kind == "routine" and d.scope.id not in cat.routines:
        errs.append(f"unknown routine {d.scope.id}")
    if d.scope.kind == "device" and d.scope.id not in cat.devices:
        errs.append(f"unknown device scope {d.scope.id}")
    return errs


def interpret(req: InterpretRequest, cat: Catalog, provider=None) -> RequirementDraft:
    """Main entry. Returns a DRAFT; raises P3CError for unsupported/invalid input. Never auto-confirms."""
    if req.household_id != cat.household_id:
        raise P3CError("HOUSEHOLD_SCOPE_ERROR", "household not available in this adapter", {"household_id": req.household_id}, 403)
    _ACTIVE_CAT.append(cat)
    try:
        rules = deterministic_interpret(req, cat)   # also performs unsupported-term rejection first
    finally:
        _ACTIVE_CAT.pop()
    if provider is None:
        return rules
    from .provider import ProviderError, llm_draft  # local import: optional dependency path
    try:
        d = llm_draft(provider, req, cat)
    except ProviderError as e:
        rules.provenance.fallback_reason = e.reason
        return rules
    except (ValidationError, ValueError, TypeError) as e:
        rules.provenance.fallback_reason = "provider_schema_invalid"
        return rules
    errs = validate_against_catalog(d, cat)
    if errs:
        rules.provenance.fallback_reason = "provider_failed_catalog_validation: " + "; ".join(errs)[:200]
        return rules
    # cross-check against deterministic rules: disagreement => keep DRAFT with explicit ambiguity
    r_e, l_e = rules.expected_behavior, d.expected_behavior
    if r_e and l_e and (r_e.device_id, r_e.capability, r_e.relation, r_e.value) != (l_e.device_id, l_e.capability, l_e.relation, l_e.value):
        d.ambiguities.append(Ambiguity(field="expected_behavior", reason="LLM interpretation disagrees with rule-based interpretation",
                                       question=f"Did you mean '{rules.title}' or '{d.title}'?", options=[rules.title, d.title]))
        d.needs_clarification = True
    d.provenance.interpreter = "llm_provider"
    return d


# ---------------------------------------------------------------- clarification + confirmation
def apply_clarification(draft: RequirementDraft, answers: dict[str, Any], cat: Catalog) -> RequirementDraft:
    _ACTIVE_CAT.append(cat)
    try:
        return _apply_clarification(draft, answers, cat)
    finally:
        _ACTIVE_CAT.pop()


def _apply_clarification(draft: RequirementDraft, answers: dict[str, Any], cat: Catalog) -> RequirementDraft:
    """Merge structured answers. Supported keys: device_id, routine_id, room, time (HH:MM + op), expected {relation,capability,value}.
    The result stays DRAFT; remaining ambiguities are recomputed, never silently dropped."""
    d = draft.model_copy(deep=True)
    allowed = {"device_id", "routine_id", "room", "condition", "expected"}
    bad = set(answers) - allowed
    if bad:
        raise P3CError("UNSUPPORTED_FIELD", f"unsupported clarification fields: {sorted(bad)}", {"allowed": sorted(allowed)})
    if "device_id" in answers:
        did = answers["device_id"]
        if did not in cat.devices:
            raise P3CError("UNSUPPORTED_DEVICE", f"unknown device {did}", {"supported": sorted(cat.devices)})
        d.scope = Scope(kind="device", id=did) if d.scope.kind != "routine" else d.scope
        d.room = cat.devices[did].room
        if d.expected_behavior:
            d.expected_behavior = d.expected_behavior.model_copy(update={"device_id": did})
        d.ambiguities = [a for a in d.ambiguities if a.field != "device"]
    if "routine_id" in answers:
        if answers["routine_id"] not in cat.routines:
            raise P3CError("UNKNOWN_ROUTINE", "unknown routine", {"known": sorted(cat.routines)})
        d.scope = Scope(kind="routine", id=answers["routine_id"])
    if "room" in answers:
        if answers["room"] not in cat.rooms:
            raise P3CError("INVALID_VALUE", "unknown room", {"rooms": cat.rooms})
        d.room = answers["room"]
        new = []
        for a in d.ambiguities:
            if a.field == "room":
                d.preconditions.append(Condition(signal=f"{answers['room']}_occupancy", op="==", value=True))
            else:
                new.append(a)
        d.ambiguities = new
    if "condition" in answers:
        c = Condition(**answers["condition"])
        d.preconditions = [x for x in d.preconditions if not (x.signal == c.signal and x.op == c.op)] + [c]
        d.ambiguities = [a for a in d.ambiguities if a.field not in ("time", "condition")]
    if "expected" in answers:
        ex = answers["expected"]
        dev = (d.expected_behavior.device_id if d.expected_behavior else (d.scope.id if d.scope.kind == "device" else None))
        if dev is None:
            raise P3CError("INVALID_INPUT", "choose a device before the expected behavior", {})
        d.expected_behavior = ExpectedBehavior(device_id=dev, **ex)
        d.ambiguities = [a for a in d.ambiguities if a.field not in ("expected_behavior", "contradiction")]
    errs = validate_against_catalog(d, cat)
    if errs:
        raise P3CError("VALIDATION_FAILED", "clarified draft failed catalog validation", {"errors": errs})
    if d.expected_behavior is None and not any(a.field == "expected_behavior" for a in d.ambiguities):
        d.ambiguities.append(Ambiguity(field="expected_behavior", reason="expected behavior still missing", question="What should (or should not) happen?"))
    d.needs_clarification = bool(d.ambiguities)
    d.title = _title(d.expected_behavior, d.preconditions, d.scope.id if d.scope.kind == "routine" else None)
    return d


def confirm(draft: RequirementDraft, cat: Catalog, confirmed_by: str, explicit_user_confirmation: bool) -> ConfirmedRequirement:
    if explicit_user_confirmation is not True:
        raise P3CError("CONFIRMATION_REQUIRED", "a draft becomes a requirement only with explicit user confirmation", {}, 409)
    if not confirmed_by or not confirmed_by.strip():
        raise P3CError("CONFIRMATION_REQUIRED", "confirmed_by is required", {}, 409)
    if draft.ambiguities or draft.needs_clarification:
        raise P3CError("DRAFT_HAS_AMBIGUITY", "resolve all clarification questions before confirming", {"open": [a.field for a in draft.ambiguities]}, 409)
    if draft.expected_behavior is None:
        raise P3CError("DRAFT_INCOMPLETE", "draft has no expected behavior", {}, 409)
    errs = validate_against_catalog(draft, cat)
    if errs:
        raise P3CError("VALIDATION_FAILED", "draft failed catalog validation", {"errors": errs}, 422)
    return ConfirmedRequirement(
        household_id=draft.household_id, title=draft.title, source_correction=draft.source_correction, scope=draft.scope,
        preconditions=draft.preconditions, expected_behavior=draft.expected_behavior, derived_from_draft_id=draft.draft_id,
        confirmation=Confirmation(confirmed_by=confirmed_by, confirmed_at=now_iso(), explicit_user_confirmation=True))
