"""Labeled clips: landmark files, replaying them, and checking reps against labels.

A clip in ``tests/clips/`` is a label sidecar ``<name>.json`` plus its input:
cached landmarks ``<name>.landmarks.json.gz`` (from a phone export, see
``tools/import_lab.py``), or a video ``<name>.mp4`` that is run through the
pose model. Landmarks are preferred: replaying them needs no model and gives
the same result on every machine.

Per-rep labels::

    {"exercise": "squat", "person": "p2", "split": "tune",
     "reps": [{"bottom_s": 3.4, "counted": true, "faults": []},
              {"bottom_s": 8.9, "counted": false, "faults": ["hip_hinge"]}]}

The older per-clip totals (``"reps": 5, "faults": {"depth": 2}``) still work.
A label with ``"draft": true`` came straight from the engine and hasn't been
reviewed yet.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .exercises import EXERCISES, Body, RepResult
from .pose import PoseFrame, PoseSmoother
from .session import Session

#: How far apart (in seconds) a labeled and a detected rep's bottoms can be and still match.
MATCH_TOLERANCE_S = 1.0


@dataclass(frozen=True)
class LabeledRep:
    bottom_s: float
    counted: bool
    faults: frozenset[str] = field(default_factory=frozenset)


@dataclass
class Landmarks:
    frames: list[tuple[float, PoseFrame | None]]
    meta: dict

    @property
    def body(self) -> Body:
        b = self.meta.get("body") or {}
        return Body(b.get("femur", "average"), b.get("torso", "average"))


def read_json(path: Path) -> dict:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict, indent: int | None = None) -> None:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt", encoding="utf-8") as f:
        json.dump(data, f, indent=indent)


def parse_frames(raw: list[dict]) -> list[tuple[float, PoseFrame | None]]:
    """Frames in the fixture layout (``t``, ``ts``, ``pose``), as used by fixtures, lab exports and caches."""
    out = []
    for f in raw:
        p = f["pose"]
        pose = None if p is None else PoseFrame(
            np.array(p["image"]), np.array(p["world"]), np.array(p["visibility"]), f["ts"])
        out.append((f["t"], pose))
    return out


def load_landmarks(path: Path) -> Landmarks:
    data = read_json(path)
    return Landmarks(parse_frames(data.pop("frames")), data)


def replay_landmarks(landmarks: Landmarks, exercise: str, body: Body | None = None) -> Session:
    """Run cached raw landmarks through the smoother and exercise, as the live app does."""
    ex, smoother, session = EXERCISES[exercise](body=body or landmarks.body), PoseSmoother(), Session(exercise)
    for t, pose in landmarks.frames:
        update = ex.update(smoother(pose), t)
        if update.completed is not None:
            session.add(update.completed)
    return session


def labeled_reps(label: dict) -> list[LabeledRep] | None:
    """The per-rep labels, or None for an older totals-only label."""
    reps = label.get("reps")
    if not isinstance(reps, list):
        return None
    return [LabeledRep(r["bottom_s"], r["counted"], frozenset(r.get("faults", []))) for r in reps]


def match_reps(detected: list[RepResult], labeled: list[LabeledRep], tolerance_s: float = MATCH_TOLERANCE_S,
               ) -> list[tuple[RepResult | None, LabeledRep | None]]:
    """Pair each labeled rep with the nearest unclaimed detected rep, by bottom time."""
    free = list(detected)
    pairs: list[tuple[RepResult | None, LabeledRep | None]] = []
    for lab in sorted(labeled, key=lambda r: r.bottom_s):
        best = min(free, key=lambda r: abs(r.bottom_s - lab.bottom_s), default=None)
        if best is not None and abs(best.bottom_s - lab.bottom_s) <= tolerance_s:
            free.remove(best)
            pairs.append((best, lab))
        else:
            pairs.append((None, lab))
    pairs.extend((r, None) for r in free)
    return sorted(pairs, key=lambda p: (p[1] or p[0]).bottom_s)


def _faults(faults, empty: str = "clean") -> str:
    return ", ".join(sorted(faults)) or empty


def compare(detected: list[RepResult], labeled: list[LabeledRep]) -> list[str]:
    """Every disagreement between the engine and the labels, readably. Empty when they agree."""
    problems = []
    for rep, lab in match_reps(detected, labeled):
        if rep is None:
            # A labeled movement that shouldn't count may be ignored outright (below min_excursion).
            if lab.counted or lab.faults:
                problems.append(f"{lab.bottom_s:.1f}s: missed rep (expected {'counted' if lab.counted else 'not counted'}, "
                                f"{_faults(lab.faults)})")
        elif lab is None:
            problems.append(f"{rep.bottom_s:.1f}s: unexpected {'counted' if rep.counted else 'not counted'} rep "
                            f"({_faults(rep.faults)})")
        else:
            if rep.counted != lab.counted:
                problems.append(f"{lab.bottom_s:.1f}s: {'counted' if rep.counted else 'not counted'}, "
                                f"expected {'counted' if lab.counted else 'not counted'}")
            if set(rep.faults) != lab.faults:
                problems.append(f"{lab.bottom_s:.1f}s: faults {_faults(rep.faults, 'none')}, "
                                f"expected {_faults(lab.faults, 'none')}")
    return problems
