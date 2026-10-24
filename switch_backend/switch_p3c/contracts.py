"""Person 3C contract objects (proposed handoff schema).

Field names follow the master spec (section 8 'Minimum requirement fields' + section 13 trace event). Person 2's real
schemas were NOT supplied; everything here is a *proposed* contract that must be reconciled with Person 2's code
(see PERSON3C_INTEGRATION_CONTRACT.md). Status enums follow the spec exactly.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ResultStatus = Literal["PASS", "FAIL", "INCONCLUSIVE"]
RequirementStatus = Literal["DRAFT", "CONFIRMED", "DISABLED", "RETIRED"]
IntegrationMode = Literal["simulated_demo", "mcp", "agent_skill"]
Provenance = Literal["local_fixture", "imported_routine", "verified_live_source"]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class P3CError(Exception):
    """Structured, user-presentable error. Never swallowed into a fabricated success."""

    def __init__(self, code: str, message: str, details: Optional[dict] = None, http_status: int = 400):
        super().__init__(message)
        self.code, self.message, self.details, self.http_status = code, message, details or {}, http_status

    def to_dict(self, correlation_id: Optional[str] = None) -> dict:
        return {"error": {"code": self.code, "message": self.message, "details": self.details,
                          "correlation_id": correlation_id or new_id("corr")}}


class Condition(Strict):
    signal: str
    op: Literal["==", "!=", ">=", "<=", ">", "<"] = "=="
    value: bool | int | float | str


class Scope(Strict):
    kind: Literal["routine", "device", "room", "household"]
    id: Optional[str] = None


class ExpectedBehavior(Strict):
    device_id: str
    capability: str
    relation: Literal["must_not_set", "must_set", "must_remain"]
    value: bool | int | float | str
    comparator: Optional[Literal["<", ">", "=="]] = None


class Ambiguity(Strict):
    field: Literal["device", "room", "routine", "condition", "time", "expected_behavior", "scope", "contradiction"]
    reason: str
    question: str
    options: list[str] = Field(default_factory=list)


class InterpretationProvenance(Strict):
    interpreter: Literal["deterministic_rules", "llm_provider"]
    provider_name: Optional[str] = None
    fallback_reason: Optional[str] = None
    heuristic_confidence: float = Field(ge=0, le=1)
    confidence_note: str = "heuristic completeness score; NOT evidence the interpretation is correct"
    context_used: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class RequirementDraft(Strict):
    schema_version: Literal["p3c.requirement.v1"] = "p3c.requirement.v1"
    draft_id: str = Field(default_factory=lambda: new_id("draft"))
    household_id: str
    title: str
    source_correction: str
    scope: Scope
    preconditions: list[Condition] = Field(default_factory=list)
    expected_behavior: Optional[ExpectedBehavior] = None
    version: int = 1
    status: Literal["DRAFT"] = "DRAFT"
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    needs_clarification: bool = False
    provenance: InterpretationProvenance
    room: Optional[str] = None


class Confirmation(Strict):
    confirmed_by: str
    confirmed_at: str
    explicit_user_confirmation: Literal[True]


class ConfirmedRequirement(Strict):
    schema_version: Literal["p3c.requirement.v1"] = "p3c.requirement.v1"
    requirement_id: str = Field(default_factory=lambda: new_id("req"))
    household_id: str
    title: str
    source_correction: str
    scope: Scope
    preconditions: list[Condition]
    expected_behavior: ExpectedBehavior
    version: int = 1
    status: Literal["CONFIRMED"] = "CONFIRMED"
    confirmation: Confirmation
    derived_from_draft_id: str
    last_result: Optional[dict] = None  # only the deterministic evaluator may populate this
    persistence_note: str = "P3C produces the confirmed object; Person 2's service owns persistence/versioning."


class InterpretRequest(Strict):
    household_id: str
    text: str = Field(min_length=1, max_length=600)
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v
