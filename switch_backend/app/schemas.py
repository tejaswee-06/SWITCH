"""Typed data model (pydantic). Structural checks only; semantic checks
(catalog, capabilities, operators) live in validation.py so errors carry
stable machine-readable codes."""
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Condition(Strict):
    op: str                                  # eq | neq | time_between
    device: Optional[str] = None
    attr: Optional[str] = None
    value: Any = None
    start: Optional[str] = None              # HH:MM (time_between)
    end: Optional[str] = None                # HH:MM, window wraps midnight


class Trigger(Strict):
    type: str                                # event | time | state
    name: Optional[str] = None
    at: Optional[str] = None
    device: Optional[str] = None
    attr: Optional[str] = None
    value: Any = None


class Action(Strict):
    action_id: str
    device: str
    attr: str
    value: Any
    conditions: list[Condition] = Field(default_factory=list)


class Routine(Strict):
    routine_id: str
    version: int
    name: str
    enabled: bool = True
    priority: int = 100                      # lower runs first; later writer wins
    triggers: list[Trigger]
    conditions: list[Condition] = Field(default_factory=list)
    actions: list[Action]
    description: Optional[str] = None        # human note (e.g. who edited it and why); not used by the simulator


class ScenarioEvent(Strict):
    event_id: str
    at: str
    kind: str                                # fire | set
    name: Optional[str] = None
    device: Optional[str] = None
    attr: Optional[str] = None
    value: Any = None


class Scenario(Strict):
    scenario_id: str
    version: int = 1
    description: str = ""
    seed: int = 0                            # recorded; simulator is currently non-random
    start: str = "00:00"
    end: str = "23:59"
    initial_state: dict[str, dict[str, Any]]  # null value == UNKNOWN state
    events: list[ScenarioEvent]
    edge_case: bool = False                  # edge-case scenarios run only in explicit exploratory replays


class Scope(Strict):
    routine_ids: list[str] = Field(default_factory=list)
    devices: list[str] = Field(default_factory=list)
    scenario_ids: list[str] = Field(default_factory=list)


class Behavior(Strict):
    kind: str                                # must_not_set | final_state_equals
    device: str
    attr: str
    value: Any


class RequirementContent(Strict):
    title: str
    source_correction: str
    scope: Scope = Field(default_factory=Scope)
    preconditions: list[Condition] = Field(default_factory=list)
    expected_behavior: Behavior
    ambiguities: list[str] = Field(default_factory=list)
    confidence: Optional[float] = None
    interpreter: str = "manual"


class RepairOp(Strict):
    op: str
    action_id: Optional[str] = None
    condition: Optional[Condition] = None
    action: Optional[Action] = None
