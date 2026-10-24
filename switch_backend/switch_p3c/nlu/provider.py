
"""Optional LLM provider for SWITCH requirement interpretation.

Supports:
- Google's native Gemini generateContent API.
- OpenAI-compatible chat-completions APIs.

Credentials are read from environment variables only. Provider failures are
reported as ProviderError so the interpreter can fall back to deterministic
rules. Model output is schema-validated and remains a proposal only.
"""
from __future__ import annotations

import json
from typing import Callable, Optional
from urllib.parse import urlparse

from .. import config
from ..contracts import (
    Ambiguity,
    Condition,
    ExpectedBehavior,
    InterpretRequest,
    InterpretationProvenance,
    RequirementDraft,
    Scope,
)
from .catalog import Catalog


SYSTEM = (
    "You convert a household correction into JSON for a smart-home requirement. "
    "Output ONLY a JSON object with keys: title, scope{kind,id}, "
    "preconditions[{signal,op,value}], "
    "expected_behavior{device_id,capability,relation,value,comparator}|null, "
    "ambiguities[{field,reason,question,options}], heuristic_confidence. "
    "relation must be must_not_set, must_set, or must_remain. "
    "Use ONLY device ids, signals and routines from the provided catalog. "
    "If anything is unclear, add an ambiguity instead of guessing. "
    "Never decide PASS/FAIL."
)


class ProviderError(Exception):
    """Safe, categorized error from an LLM provider."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail


class LLMProvider:
    name = "abstract"

    def complete(self, system: str, user: str, timeout_s: float) -> str:
        raise NotImplementedError


class OpenAICompatibleProvider(LLMProvider):
    """OpenAI-compatible provider with native Gemini support."""

    name = "openai_compatible"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        post: Optional[Callable] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model.strip()
        self._post = post

        hostname = (urlparse(self.base_url).hostname or "").lower()
        self._is_google = hostname == "generativelanguage.googleapis.com"

    @classmethod
    def from_env(cls) -> Optional["OpenAICompatibleProvider"]:
        if not (
            config.LLM_BASE_URL
            and config.LLM_API_KEY
            and config.LLM_MODEL
        ):
            return None

        return cls(
            config.LLM_BASE_URL,
            config.LLM_API_KEY,
            config.LLM_MODEL,
        )

    def complete(self, system: str, user: str, timeout_s: float) -> str:
        import requests

        post = self._post or requests.post

        if self._is_google:
            return self._complete_gemini(post, system, user, timeout_s)

        return self._complete_openai_compatible(
            post, system, user, timeout_s
        )

    def _complete_gemini(
        self,
        post: Callable,
        system: str,
        user: str,
        timeout_s: float,
    ) -> str:
        """Call Google's native Gemini generateContent endpoint."""
        import requests

        # The configured URL may be Google's OpenAI-compatible endpoint.
        # Native Gemini requests use /v1beta/models/{model}:generateContent.
        model = self.model.removeprefix("models/").strip()
        if not model:
            raise ProviderError("provider_configuration", "missing model")

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )

        payload = {
            "systemInstruction": {
                "parts": [{"text": system}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user}],
                }
            ],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "maxOutputTokens": 2048,
            },
        }

        try:
            response = post(
                url,
                params={"key": self.api_key},
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=max(float(timeout_s), 30.0),
            )
        except requests.Timeout as exc:
            raise ProviderError(
                "provider_timeout",
                "Gemini generation timed out",
            ) from exc
        except requests.RequestException as exc:
            raise ProviderError(
                "provider_unavailable",
                type(exc).__name__,
            ) from exc

        if response.status_code != 200:
            # Avoid including request URLs or credentials in error messages.
            try:
                body = response.json()
                error = body.get("error", {})
                message = str(error.get("message", "request failed"))[:300]
                code = error.get("status", "")
            except (ValueError, AttributeError):
                message = "request failed"
                code = ""

            detail = f"http {response.status_code}"
            if code:
                detail += f" {code}"
            detail += f": {message}"

            raise ProviderError("provider_unavailable", detail)

        try:
            body = response.json()
            candidates = body["candidates"]
            parts = candidates[0]["content"]["parts"]
            text_parts = [
                part["text"]
                for part in parts
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            content = "".join(text_parts).strip()

            if not content:
                raise ValueError("empty model response")

            return content

        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError(
                "provider_malformed_response",
                type(exc).__name__,
            ) from exc

    def _complete_openai_compatible(
        self,
        post: Callable,
        system: str,
        user: str,
        timeout_s: float,
    ) -> str:
        """Call a standard OpenAI-compatible chat-completions endpoint."""
        import requests

        url = f"{self.base_url}/chat/completions"

        try:
            response = post(
                url,
                timeout=timeout_s,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
        except requests.Timeout as exc:
            raise ProviderError(
                "provider_timeout",
                "chat-completions request timed out",
            ) from exc
        except requests.RequestException as exc:
            raise ProviderError(
                "provider_unavailable",
                type(exc).__name__,
            ) from exc

        if response.status_code != 200:
            raise ProviderError(
                "provider_unavailable",
                f"http {response.status_code}",
            )

        try:
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("content is not a string")
            return content
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError(
                "provider_malformed_response",
                type(exc).__name__,
            ) from exc


def llm_draft(
    provider: LLMProvider,
    req: InterpretRequest,
    cat: Catalog,
) -> RequirementDraft:
    """Create a validated proposal. Never evaluates PASS/FAIL."""

    catalog_view = {
        "devices": {
            key: value.capabilities
            for key, value in cat.devices.items()
        },
        "routines": list(cat.routines),
        "signals": cat.signals,
    }

    user = json.dumps(
        {
            "statement": req.text,
            "context": {
                key: value
                for key, value in req.context.items()
                if key in ("selected_device_id", "selected_routine_id")
            },
            "catalog": catalog_view,
        },
        default=list,
    )

    try:
        raw = provider.complete(
            SYSTEM,
            user,
            config.LLM_TIMEOUT_S,
        )
    except ProviderError:
        raise
    except TimeoutError as exc:
        raise ProviderError(
            "provider_timeout",
            type(exc).__name__,
        ) from exc
    except Exception as exc:
        raise ProviderError(
            "provider_unavailable",
            type(exc).__name__,
        ) from exc

    if not isinstance(raw, str):
        raise ProviderError(
            "provider_malformed_response",
            "non-string",
        )

    text = raw.strip()

    # Tolerate a Markdown JSON fence, but do not accept arbitrary prose.
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "provider_malformed_json",
            str(exc)[:80],
        ) from exc

    if not isinstance(obj, dict):
        raise ProviderError(
            "provider_malformed_json",
            "not an object",
        )

    allowed = {
        "title",
        "scope",
        "preconditions",
        "expected_behavior",
        "ambiguities",
        "heuristic_confidence",
    }
    extra = set(obj) - allowed

    if extra:
        raise ProviderError(
            "provider_schema_invalid",
            f"unexpected keys {sorted(extra)}",
        )

    try:
        expected = obj.get("expected_behavior")

        draft = RequirementDraft(
            household_id=req.household_id,
            title=str(obj.get("title", ""))[:140] or "LLM draft",
            source_correction=req.text,
            scope=Scope(**obj["scope"]),
            preconditions=[
                Condition(**condition)
                for condition in obj.get("preconditions", [])
            ],
            expected_behavior=(
                ExpectedBehavior(**expected) if expected else None
            ),
            ambiguities=[
                Ambiguity(**ambiguity)
                for ambiguity in obj.get("ambiguities", [])
            ],
            provenance=InterpretationProvenance(
                interpreter="llm_provider",
                provider_name=provider.name,
                heuristic_confidence=min(
                    1.0,
                    max(
                        0.0,
                        float(obj.get("heuristic_confidence", 0.5)),
                    ),
                ),
            ),
        )

        if draft.expected_behavior is None and not draft.ambiguities:
            draft.ambiguities.append(
                Ambiguity(
                    field="expected_behavior",
                    reason="LLM returned no expected behavior",
                    question="What should happen?",
                )
            )

        draft.needs_clarification = bool(draft.ambiguities)

        if draft.expected_behavior:
            device_id = draft.expected_behavior.device_id
            if device_id in cat.devices:
                draft.room = cat.devices[device_id].room

        return draft

    except ProviderError:
        raise
    except Exception as exc:
        raise ProviderError(
            "provider_schema_invalid",
            type(exc).__name__,
        ) from exc
