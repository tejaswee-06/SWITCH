"""CASAS sensor-event parsing + validation (superset of the notebook parser).

Supports: date+time columns or a single timestamp; comma/tab/space delimiters; optional headers;
trailing activity labels either as a plain label or as `Label begin` / `Label end` markers
(labels are then carried forward between begin and end).
"""
from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

import pandas as pd

_TS_FORMATS = ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
               "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ")
NULL_LABELS = {"", "-", "none", "nan", "null", "unknown"}


def parse_timestamp(text: str) -> datetime | None:
    text = text.strip()
    for fmt in _TS_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _split(line: str) -> list[str]:
    if "," in line:
        parts = line.split(",")
    elif "\t" in line:
        parts = line.split("\t")
    else:
        parts = re.split(r"\s+", line)
    return [p.strip().strip('"').strip("'") for p in parts if p.strip() != ""]


def parse_casas_lines(lines: Iterable[str], home_id: str, source: str = "") -> pd.DataFrame:
    rows, current = [], ""
    for n, raw in enumerate(lines, 1):
        line = raw.strip().lstrip("﻿")
        if not line or line.startswith(("#", "//", "%")):
            continue
        parts = _split(line)
        if len(parts) < 3 or parts[0].lower() in {"date", "timestamp", "datetime"}:
            continue
        ts, s_idx, m_idx = None, None, None
        if len(parts) >= 4:
            ts = parse_timestamp(parts[0] + " " + parts[1])
            if ts is not None:
                s_idx, m_idx = 2, 3
        if ts is None:
            ts = parse_timestamp(parts[0])
            if ts is not None:
                s_idx, m_idx = 1, 2
        if ts is None or s_idx is None or s_idx >= len(parts):
            continue
        sensor = parts[s_idx]
        message = parts[m_idx].upper() if m_idx < len(parts) else ""
        extra = " ".join(parts[m_idx + 1:]).strip()
        label = ""
        if extra and extra.lower() not in NULL_LABELS:
            m = re.match(r"^(.*?)[\s_]+(begin|end)$", extra, flags=re.I)
            if m:
                if m.group(2).lower() == "begin":
                    current, label = m.group(1).strip(), m.group(1).strip()
                else:
                    label, current = m.group(1).strip(), ""
            else:
                label = extra
        elif current:
            label = current
        rows.append({"timestamp": pd.Timestamp(ts), "home_id": home_id, "sensor": sensor, "message": message,
                     "activity": label, "source_file": source, "source_line": n})
    return pd.DataFrame(rows, columns=["timestamp", "home_id", "sensor", "message", "activity",
                                       "source_file", "source_line"])


def parse_casas_file(path: str | Path, home_id: str | None = None) -> pd.DataFrame:
    path = Path(path)
    text = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return parse_casas_lines(text, home_id or path.stem, path.name)


def load_directory(root: str | Path, exts=(".txt", ".data", ".csv", ".ann", ".log", ".dat", ".tsv")) -> pd.DataFrame:
    """One home per file unless files live in multiple sub-folders (then folder = home), as in the notebook."""
    root = Path(root)
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in exts)
    if not files:
        raise FileNotFoundError(f"no CASAS data files under {root}")
    parents = {str(p.relative_to(root).parent) for p in files}
    by_folder = len(parents) > 1 and any(x not in {".", ""} for x in parents)
    frames = []
    for p in files:
        rel = p.relative_to(root)
        home = str(rel.parent).replace("\\", "/") if by_folder and str(rel.parent) not in {".", ""} else p.stem
        f = parse_casas_file(p, home)
        if not f.empty:
            frames.append(f)
    if not frames:
        raise ValueError("no sensor rows parsed; inspect the file layout, do not fabricate labels")
    ev = pd.concat(frames, ignore_index=True)
    return ev.sort_values(["home_id", "timestamp", "source_line"], kind="stable").reset_index(drop=True)


def validate_events(ev: pd.DataFrame) -> dict:
    return {
        "rows": int(len(ev)), "homes": int(ev.home_id.nunique()),
        "labelled_rows": int((ev.activity.astype(str).str.len() > 0).sum()),
        "duplicate_rows": int(ev.duplicated(["home_id", "timestamp", "sensor", "message"]).sum()),
    }
