"""Window feature extraction. Stateless: every feature is computable from the 30 events alone, so inference
needs no home context. Features avoid raw sensor IDs because IDs are home-specific and do not transfer to unseen homes.
"""
from __future__ import annotations
import math
from collections import Counter
from typing import Sequence

import numpy as np
import pandas as pd

from ..config import WINDOW_EVENTS

SENSOR_TYPE_RE = __import__("re").compile(r"^([A-Za-z]+)")


def sensor_type(sensor: str) -> str:
    m = SENSOR_TYPE_RE.match(str(sensor))
    return m.group(1).upper() if m else "UNK"


def window_features(ts: Sequence[pd.Timestamp], sensors: Sequence[str], messages: Sequence[str]) -> dict:
    n = len(sensors)
    feats: dict[str, float] = {}
    types = [sensor_type(s) for s in sensors]
    for t, c in Counter(types).items():
        feats[f"type::{t}"] = c / n
    for tm, c in Counter(f"{ty}={m}" for ty, m in zip(types, messages)).items():
        feats[f"typemsg::{tm}"] = c / n
    t0, t1 = pd.Timestamp(ts[0]), pd.Timestamp(ts[-1])
    mid = t0 + (t1 - t0) / 2
    hour = mid.hour + mid.minute / 60
    feats["hour_sin"], feats["hour_cos"] = math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24)
    feats["is_weekend"] = float(mid.dayofweek >= 5)
    secs = np.array([pd.Timestamp(x).value for x in ts], dtype="float64") / 1e9
    gaps = np.clip(np.diff(secs), 0, None)
    feats["duration_log"] = math.log1p(float(secs[-1] - secs[0]))
    feats["gap_mean_log"] = math.log1p(float(gaps.mean())) if len(gaps) else 0.0
    feats["gap_median_log"] = math.log1p(float(np.median(gaps))) if len(gaps) else 0.0
    feats["gap_max_log"] = math.log1p(float(gaps.max())) if len(gaps) else 0.0
    feats["gap_lt5s"] = float((gaps < 5).mean()) if len(gaps) else 0.0
    cnt = Counter(sensors)
    feats["unique_sensors_frac"] = len(cnt) / n
    feats["top_sensor_share"] = max(cnt.values()) / n
    feats["switches_frac"] = sum(1 for a, b in zip(sensors, sensors[1:]) if a != b) / max(n - 1, 1)
    feats["on_frac"] = sum(1 for m in messages if m in {"ON", "OPEN", "PRESENT"}) / n
    # entropy of sensor usage in the window (home-agnostic measure of how spread movement is)
    p = np.array(list(cnt.values()), dtype=float) / n
    feats["sensor_entropy"] = float(-(p * np.log2(p)).sum())
    # --- segment features: thirds of the window, to characterise windows that straddle an activity change
    k = n // 3
    for i, (a, b) in enumerate(((0, k), (k, 2 * k), (2 * k, n))):
        seg_t, seg_s = types[a:b], sensors[a:b]
        for t in ("M", "D", "T"):
            feats[f"seg{i}_type_{t}"] = sum(1 for x in seg_t if x == t) / max(len(seg_t), 1)
        feats[f"seg{i}_uniq"] = len(set(seg_s)) / max(len(seg_s), 1)
        feats[f"seg{i}_gap_log"] = math.log1p(float(np.clip(np.diff(secs[a:b]), 0, None).mean())) if b - a > 1 else 0.0
    feats["seg_gap_trend"] = feats["seg2_gap_log"] - feats["seg0_gap_log"]
    top2 = sum(v for _, v in cnt.most_common(2)) / n
    feats["top2_sensor_share"] = top2
    feats["revisit_rate"] = 1 - len(cnt) / n
    feats["hour_gap_interaction"] = feats["hour_cos"] * feats["gap_mean_log"]
    return feats


def frame_windows(frame: pd.DataFrame, window: int = WINDOW_EVENTS):
    """Non-overlapping windows of `window` consecutive events within each home. Returns feats, labels, groups, purity."""
    F, y, g, purity = [], [], [], []
    for home, h in frame.groupby("home_id", sort=True):
        h = h.sort_values(["timestamp", "source_line"], kind="stable").reset_index(drop=True)
        for end in range(window, len(h) + 1, window):
            w = h.iloc[end - window:end]
            F.append(window_features(w.timestamp.tolist(), w.sensor.astype(str).tolist(), w.message.astype(str).tolist()))
            lab = w.activity.astype(str)
            lab = lab[lab.str.len() > 0]
            if lab.empty:
                y.append("")
                purity.append(0.0)
            else:
                top = lab.value_counts()
                y.append(top.index[0])
                purity.append(float(top.iloc[0]) / window)
            g.append(home)
    return F, pd.Series(y, name="activity"), pd.Series(g, name="home_id"), np.array(purity)


def events_to_window(events: Sequence[dict]) -> dict:
    """API-side: list of {timestamp, sensor, message} (already validated) -> feature dict."""
    ts = [pd.Timestamp(e["timestamp"]) for e in events]
    return window_features(ts, [str(e["sensor"]) for e in events], [str(e["message"]).upper() for e in events])
