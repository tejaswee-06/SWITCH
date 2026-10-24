"""One-shot evaluation of SAVED artifacts on a directory of homes never used for training/selection."""
from __future__ import annotations
import argparse, json
from pathlib import Path

import joblib, numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

from .. import config
from . import features, parse
from .train import wilson


def evaluate(data_dir: str, artifact_dir: str, data_source: str) -> dict:
    model = joblib.load(Path(artifact_dir) / config.MODEL_FILE)
    vec = joblib.load(Path(artifact_dir) / config.VECTORIZER_FILE)
    ev = parse.load_directory(data_dir)
    F, y, g, pur = features.frame_windows(ev, config.WINDOW_EVENTS)
    keep = (y.str.len() > 0).to_numpy() & y.isin(list(model.classes_)).to_numpy()
    excluded = int((y.str.len() > 0).sum() - keep.sum())
    X = vec.transform([f for f, k in zip(F, keep) if k]); yt = y[keep].reset_index(drop=True)
    p = model.predict(X)
    labels = sorted(set(yt) | set(p))
    rep = classification_report(yt, p, labels=labels, output_dict=True, zero_division=0)
    k, n = int((p == yt.to_numpy()).sum()), len(yt)
    pk = pur[keep]; ok = (p == yt.to_numpy())
    by_purity = {"pure_windows_ge_0.9": {"n": int((pk >= .9).sum()), "accuracy": float(ok[pk >= .9].mean())},
                 "mixed_windows_lt_0.9": {"n": int((pk < .9).sum()), "accuracy": float(ok[pk < .9].mean())},
                 "mean_label_purity": float(pk.mean()),
                 "note": "diagnostic only: windows that straddle several activities have an ambiguous majority label"}
    return {"data_source": data_source, "accuracy_by_label_purity": by_purity, "homes": sorted(g.unique().tolist()), "windows": n,
            "windows_excluded_label_not_in_model": excluded,
            "class_distribution": {a: int(b) for a, b in yt.value_counts().items()},
            "accuracy": k / n, "accuracy_wilson95": wilson(k, n),
            "macro_f1": float(f1_score(yt, p, average="macro", labels=labels, zero_division=0)),
            "weighted_f1": float(f1_score(yt, p, average="weighted", labels=labels, zero_division=0)),
            "per_class": {c: {kk: float(rep[c][kk]) for kk in ("precision", "recall", "f1-score", "support")} for c in labels},
            "confusion_matrix": {"labels": labels, "matrix": confusion_matrix(yt, p, labels=labels).tolist()}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--artifacts", default=str(config.ARTIFACT_DIR)); ap.add_argument("--data-source", required=True)
    a = ap.parse_args()
    m = evaluate(a.data, a.artifacts, a.data_source)
    Path(a.out).write_text(json.dumps(m, indent=2))
    print(json.dumps({k: m[k] for k in ("windows", "accuracy", "accuracy_wilson95", "macro_f1", "weighted_f1")}, indent=2))
