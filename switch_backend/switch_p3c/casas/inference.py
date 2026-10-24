"""Artifact loading + prediction. Loaded once at service startup; never trains."""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path

import joblib, numpy as np

from .. import config
from . import features


class ArtifactError(RuntimeError):
    pass


@dataclass
class ActivityModel:
    model: object = None
    vectorizer: object = None
    metrics: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
    ready: bool = False
    error: str = ""
    window_events: int = config.WINDOW_EVENTS

    @classmethod
    def load(cls, directory: Path | str | None = None) -> "ActivityModel":
        d = Path(directory or config.ARTIFACT_DIR)
        am = cls()
        try:
            for f in (config.MODEL_FILE, config.VECTORIZER_FILE):
                if not (d / f).is_file():
                    raise ArtifactError(f"missing artifact: {f}")
            model = joblib.load(d / config.MODEL_FILE)
            vec = joblib.load(d / config.VECTORIZER_FILE)
            if not hasattr(model, "predict_proba") or not hasattr(vec, "transform"):
                raise ArtifactError("artifact objects are not a classifier/vectorizer")
            n_vec, n_model = len(vec.feature_names_), getattr(model, "n_features_in_", None)
            if n_vec != n_model:
                raise ArtifactError(f"vectorizer ({n_vec}) and model ({n_model}) feature counts differ")
            am.model, am.vectorizer = model, vec
            if (d / config.METRICS_FILE).is_file():
                am.metrics = json.loads((d / config.METRICS_FILE).read_text())
            if (d / config.METADATA_FILE).is_file():
                am.metadata = json.loads((d / config.METADATA_FILE).read_text())
                am.window_events = int(am.metadata.get("window_events", config.WINDOW_EVENTS))
            # smoke test: a real forward pass proves the pair works
            am.model.predict(am.vectorizer.transform([{}]))
            am.ready = True
        except Exception as e:  # corrupt pickle, version mismatch, etc. => honest not-ready
            am.ready, am.error = False, f"{type(e).__name__}: {e}"
            am.model = am.vectorizer = None
        return am

    def predict_window(self, events: list[dict]) -> dict:
        if not self.ready:
            raise ArtifactError(self.error or "model not ready")
        if len(events) != self.window_events:
            raise ValueError(f"exactly {self.window_events} events required, got {len(events)}")
        X = self.vectorizer.transform([features.events_to_window(events)])
        proba = self.model.predict_proba(X)[0]
        order = np.argsort(proba)[::-1]
        cls = self.model.classes_
        return {"activity": str(cls[order[0]]), "probability": float(proba[order[0]]),
                "top3": [{"activity": str(cls[i]), "probability": float(proba[i])} for i in order[:3]],
                "window_events": len(events),
                "note": "activity context only; not a safety classification and not a PASS/FAIL signal"}
