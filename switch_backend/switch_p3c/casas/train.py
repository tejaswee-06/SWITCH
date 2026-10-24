"""Reproducible CASAS activity-context training + home-held-out evaluation.

    python -m switch_p3c.casas.train --data data/synthetic --data-source synthetic
    python -m switch_p3c.casas.train --data path/to/extracted/new_labeled_data --data-source casas_real

Protocol (no test-set tuning):
  1. split HOMES into train/test once (GroupShuffleSplit, fixed seed);
  2. model selection with GroupKFold over TRAIN homes only;
  3. refit selected model on all train homes; evaluate ONCE on the untouched test homes.
The shipped artifact is always a RandomForest (name mandated by the contract); other families are CV comparisons only.
"""
from __future__ import annotations
import argparse, hashlib, json, math, platform, sys, time
from pathlib import Path

import joblib, numpy as np, pandas as pd, sklearn
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction import DictVectorizer
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

from .. import config
from . import features, parse


def wilson(k: int, n: int, z: float = 1.96) -> list[float]:
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def raw_sensor_baseline_features(frame: pd.DataFrame, window: int):
    """Notebook baseline: raw sensor=message counts + hour/weekday/gap (home-specific IDs)."""
    from collections import Counter
    F = []
    for home, h in frame.groupby("home_id", sort=True):
        h = h.sort_values(["timestamp", "source_line"], kind="stable").reset_index(drop=True)
        for end in range(window, len(h) + 1, window):
            w = h.iloc[end - window:end]
            row = {f"event::{k}": v for k, v in Counter((w.sensor.astype(str) + "=" + w.message.astype(str))).items()}
            row["hour"] = int(w.iloc[-1].timestamp.hour)
            row["weekday"] = int(w.iloc[-1].timestamp.dayofweek)
            g = w.timestamp.diff().dt.total_seconds().to_numpy()[1:]
            row["mean_gap_seconds"] = float(np.clip(g, 0, None).mean())
            row["unique_sensors"] = int(w.sensor.nunique())
            F.append(row)
    return F


def candidates(seed: int):
    return {
        "rf_300_leaf2_balanced": RandomForestClassifier(n_estimators=300, min_samples_leaf=2, class_weight="balanced_subsample", random_state=seed, n_jobs=-1),
        "rf_500_leaf1_balanced": RandomForestClassifier(n_estimators=500, min_samples_leaf=1, class_weight="balanced_subsample", random_state=seed, n_jobs=-1),
        "rf_300_leaf3_sqrt_balanced": RandomForestClassifier(n_estimators=300, min_samples_leaf=3, max_features="sqrt", class_weight="balanced_subsample", random_state=seed, n_jobs=-1),
    }, {
        "extra_trees_400_balanced": ExtraTreesClassifier(n_estimators=400, class_weight="balanced_subsample", random_state=seed, n_jobs=-1),
        "hist_gb_balanced": HistGradientBoostingClassifier(class_weight="balanced", random_state=seed, max_iter=200),
    }


def cv_score(model, X, y, groups, n_splits, seed):
    accs, f1s = [], []
    for tr, va in GroupKFold(n_splits=n_splits).split(X, y, groups):
        m = sklearn.base.clone(model).fit(X[tr], y.iloc[tr])
        p = m.predict(X[va])
        accs.append(accuracy_score(y.iloc[va], p))
        f1s.append(f1_score(y.iloc[va], p, average="macro", zero_division=0))
    return {"cv_accuracy_mean": float(np.mean(accs)), "cv_macro_f1_mean": float(np.mean(f1s)), "cv_macro_f1_folds": [float(x) for x in f1s]}


def run(data_dir: str, out_dir: str, data_source: str, seed: int = config.RANDOM_SEED, window: int = config.WINDOW_EVENTS,
        min_class_windows: int = 10, test_size: float = 0.25, cv_folds: int = 5) -> dict:
    t_start = time.time()
    ev = parse.load_directory(data_dir)
    info = parse.validate_events(ev)
    Fd, y, g, purity = features.frame_windows(ev, window)
    lab = y.str.len() > 0
    Fd = [f for f, k in zip(Fd, lab) if k]; y, g, purity = y[lab].reset_index(drop=True), g[lab].reset_index(drop=True), purity[lab.to_numpy()]
    raw_F = [f for f, k in zip(raw_sensor_baseline_features(ev, window), lab) if k]
    counts = y.value_counts()
    keep = y.isin(counts[counts >= min_class_windows].index).to_numpy()
    dropped = sorted(set(y.unique()) - set(y[keep].unique()))
    Fd = [f for f, k in zip(Fd, keep) if k]; raw_F = [f for f, k in zip(raw_F, keep) if k]
    y, g, purity = y[keep].reset_index(drop=True), g[keep].reset_index(drop=True), purity[keep]
    if g.nunique() < 4:
        raise RuntimeError("need >=4 homes for a home-held-out split with CV; refusing to report misleading metrics")

    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed).split(Fd, y, groups=g))
    train_homes, test_homes = sorted(g.iloc[tr].unique()), sorted(g.iloc[te].unique())
    assert not set(train_homes) & set(test_homes)

    vec = DictVectorizer(sparse=False)
    Xtr = vec.fit_transform([Fd[i] for i in tr]); Xte = vec.transform([Fd[i] for i in te])
    ytr, yte, gtr = y.iloc[tr].reset_index(drop=True), y.iloc[te].reset_index(drop=True), g.iloc[tr].reset_index(drop=True)

    # duplicate-leak check: identical feature vectors in both train and test
    tr_set = {tuple(np.round(r, 6)) for r in Xtr}
    dup_te = sum(tuple(np.round(r, 6)) in tr_set for r in Xte)

    rf_c, other_c = candidates(seed)
    cv = {}
    for name, m in {**rf_c, **other_c}.items():
        cv[name] = {**cv_score(m, Xtr, ytr, gtr, min(cv_folds, len(train_homes)), seed), "shipped_family": name in rf_c}
    # baseline (notebook raw-ID features) on train homes only
    bvec = DictVectorizer(sparse=True)
    Btr = bvec.fit_transform([raw_F[i] for i in tr]); Bte = bvec.transform([raw_F[i] for i in te])
    sel = max(rf_c, key=lambda k: cv[k]["cv_macro_f1_mean"])  # RF only, by CV macro-F1 on train homes
    model = sklearn.base.clone(rf_c[sel]).fit(Xtr, ytr)
    base = RandomForestClassifier(n_estimators=180, min_samples_leaf=2, class_weight="balanced_subsample", random_state=seed, n_jobs=-1).fit(Btr, ytr)

    pred = model.predict(Xte)
    bpred = base.predict(Bte)
    classes = sorted(set(ytr) | set(yte))
    rep = classification_report(yte, pred, labels=classes, output_dict=True, zero_division=0)
    k = int((pred == yte.to_numpy()).sum()); n = int(len(yte))
    per_home = {h: {"windows": int((g.iloc[te].reset_index(drop=True) == h).sum()),
                    "accuracy": float(accuracy_score(yte[(g.iloc[te].reset_index(drop=True) == h)], pred[(g.iloc[te].reset_index(drop=True) == h).to_numpy()]))} for h in test_homes}
    min_recall = min(rep[c]["recall"] for c in classes if rep[c]["support"] > 0)
    metrics = {
        "task": "CASAS activity-context classification (NOT a safety/conflict classifier)",
        "data_source": data_source,
        "data_source_warning": ("SYNTHETIC data generated by switch_p3c.casas.synthetic. These numbers show the pipeline works; they are NOT accuracy on real CASAS."
                                if data_source == "synthetic" else "Real CASAS data supplied by user."),
        "window_events": window, "random_seed": seed, "min_class_windows": min_class_windows,
        "dataset": {**info, "windows_labelled_after_filter": int(len(y)), "classes_dropped_below_min": dropped,
                    "class_distribution_windows": {k: int(v) for k, v in y.value_counts().items()},
                    "mean_window_label_purity": float(purity.mean()),
                    "label_rule": "most frequent activity label inside each non-overlapping 30-event window"},
        "split": {"method": "GroupShuffleSplit by home", "train_homes": train_homes, "test_homes": test_homes,
                  "train_windows": int(len(tr)), "test_windows": n,
                  "test_class_distribution": {k: int(v) for k, v in yte.value_counts().items()},
                  "train_class_distribution": {k: int(v) for k, v in ytr.value_counts().items()},
                  "identical_feature_vectors_train_and_test": int(dup_te)},
        "model_selection": {"method": f"GroupKFold({min(cv_folds, len(train_homes))}) on train homes only; selection metric = CV macro-F1 among RF configs",
                            "candidates": cv, "selected": sel},
        "held_out_test": {
            "accuracy": k / n, "accuracy_wilson95": wilson(k, n),
            "ci_note": "Wilson interval treats windows as independent; windows within a home are correlated, so the true interval is wider.",
            "macro_f1": float(f1_score(yte, pred, average="macro", labels=classes, zero_division=0)),
            "weighted_f1": float(f1_score(yte, pred, average="weighted", labels=classes, zero_division=0)),
            "min_class_recall": float(min_recall),
            "per_class": {c: {kk: float(rep[c][kk]) for kk in ("precision", "recall", "f1-score", "support")} for c in classes},
            "confusion_matrix": {"labels": classes, "matrix": confusion_matrix(yte, pred, labels=classes).tolist()},
            "per_home": per_home,
            "target_accuracy_gt_0.90_met": bool(k / n > 0.90),
        },
        "baseline_notebook_raw_sensor_id_features": {
            "accuracy": float(accuracy_score(yte, bpred)), "macro_f1": float(f1_score(yte, bpred, average="macro", labels=classes, zero_division=0)),
            "note": "Notebook features (raw sensor IDs) evaluated on the same held-out homes, for comparison only."},
        "limitations": [
            "Predicts source activity annotations only; not a household safety classifier and never authority for accepting a repair.",
            "Windows may span several activities; label is the majority label.",
            "Home-held-out evaluation over few homes is high-variance.",
        ],
    }
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, out / config.MODEL_FILE); joblib.dump(vec, out / config.VECTORIZER_FILE)
    (out / config.METRICS_FILE).write_text(json.dumps(metrics, indent=2))
    meta = {"trained_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "python": platform.python_version(),
            "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "seed": seed,
            "window_events": window, "feature_names": list(vec.feature_names_), "classes": [str(c) for c in model.classes_],
            "data_source": data_source, "selected_config": sel, "selected_params": model.get_params(),
            "train_seconds": round(time.time() - t_start, 1),
            "artifact_sha256": {f: hashlib.sha256((out / f).read_bytes()).hexdigest() for f in (config.MODEL_FILE, config.VECTORIZER_FILE)},
            "command": "python -m switch_p3c.casas.train " + " ".join(sys.argv[1:])}
    (out / config.METADATA_FILE).write_text(json.dumps(meta, indent=2, default=str))
    return metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default=str(config.ARTIFACT_DIR))
    ap.add_argument("--data-source", choices=["synthetic", "casas_real"], required=True)
    ap.add_argument("--seed", type=int, default=config.RANDOM_SEED)
    a = ap.parse_args()
    m = run(a.data, a.out, a.data_source, a.seed)
    h = m["held_out_test"]
    print(json.dumps({"data_source": m["data_source"], "selected": m["model_selection"]["selected"], "test_windows": m["split"]["test_windows"],
                      "accuracy": round(h["accuracy"], 4), "wilson95": h["accuracy_wilson95"], "macro_f1": round(h["macro_f1"], 4),
                      "weighted_f1": round(h["weighted_f1"], 4), "min_class_recall": round(h["min_class_recall"], 4),
                      "baseline_accuracy": round(m["baseline_notebook_raw_sensor_id_features"]["accuracy"], 4)}, indent=2))


if __name__ == "__main__":
    main()
