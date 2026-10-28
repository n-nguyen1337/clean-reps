"""Export parity fixtures for the web engine.

Runs clips through PoseLandmarker, then replays the (rounded) raw landmarks
through the Python smoother, exercise and cue manager, recording what each
frame produced. The TypeScript tests in ``web/`` feed the same raw landmarks
through the TS port and must reproduce the same output.

    python tools/export_fixtures.py -e squat vids/clip.mp4 [-o web/fixtures]

Cached landmarks (``*.landmarks.json.gz`` from ``tools/import_lab.py``) are
used as they are, so phone clips become fixtures without re-running the model.

Fixtures contain landmarks only, not video frames.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from cleanreps.capture import VideoSource
from cleanreps.exercises import EXERCISES
from cleanreps.feedback import CueManager
from cleanreps.labels import parse_frames, read_json
from cleanreps.pose import PoseEstimator, PoseSmoother

DECIMALS = 6


def _num(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)


def _rep(r):
    return {"counted": r.counted, "index": r.index, "start_s": r.start_s, "bottom_s": r.bottom_s,
            "end_s": r.end_s, "faults": list(r.faults),
            "extremes": {k: list(v) for k, v in r.extremes.items()}}


def estimate(clip: Path, model: str) -> tuple[list[dict], int, int]:
    """Raw landmarks for every frame of a video, rounded as stored."""
    raw = []
    with VideoSource(str(clip), mirror=False) as source, PoseEstimator(model) as estimator:
        width = height = None
        while (item := source.read()) is not None:
            frame, t = item
            height, width = frame.shape[:2]
            pose = estimator.process(frame, int(t * 1000))
            if pose is None:
                raw.append({"t": t, "ts": estimator._last_ts, "pose": None})
            else:
                raw.append({"t": t, "ts": pose.timestamp_ms, "pose": {
                    "image": np.round(pose.image, DECIMALS).tolist(),
                    "world": np.round(pose.world, DECIMALS).tolist(),
                    "visibility": np.round(pose.visibility, DECIMALS).tolist(),
                }})
    return raw, width, height


def export(clip: Path, exercise: str, model: str) -> dict:
    if clip.name.endswith(".landmarks.json.gz"):
        cached = read_json(clip)
        raw, width, height = cached["frames"], cached["width"], cached["height"]
    else:
        raw, width, height = estimate(clip, model)

    # Replay from the rounded landmarks so both sides start from identical input.
    ex, smoother, cues = EXERCISES[exercise](), PoseSmoother(), CueManager()
    frames = []
    for f, (_, pose) in zip(raw, parse_frames(raw)):
        update = ex.update(smoother(pose), f["t"])
        cues.push(update.cues, f["t"])
        active = cues.current(f["t"])
        frames.append({**f, "expected": {
            "phase": update.phase.value, "reps": update.reps, "tracking": update.tracking, "ready": update.ready,
            "top": ex.top, "standing": ex.standing,
            "metrics": {k: _num(v) for k, v in update.metrics.items()},
            "cues": [c.id for c in update.cues],
            "active_cue": active.id if active else None,
            "completed": _rep(update.completed) if update.completed else None,
        }})
    return {"clip": clip.name, "exercise": exercise, "width": width, "height": height,
            "frames": frames}


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("clips", nargs="+", type=Path)
    p.add_argument("-e", "--exercise", choices=sorted(EXERCISES), required=True)
    p.add_argument("-m", "--model", default="full")
    p.add_argument("-o", "--out", type=Path, default=Path("web/fixtures"))
    args = p.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    for clip in args.clips:
        data = export(clip, args.exercise, args.model)
        stem = clip.name.removesuffix(".landmarks.json.gz") if clip.name.endswith(".gz") else clip.stem
        path = args.out / f"{stem}.{args.exercise}.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        reps = data["frames"][-1]["expected"]["reps"] if data["frames"] else 0
        print(f"{path}: {len(data['frames'])} frames, {reps} reps")


if __name__ == "__main__":
    main()
