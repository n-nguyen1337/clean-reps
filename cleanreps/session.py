"""Collects rep results and writes a session log."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from statistics import mean

from .exercises import RepResult


class Session:
    def __init__(self, exercise: str):
        self.exercise = exercise
        self.started = datetime.now()
        self.reps: list[RepResult] = []

    def add(self, rep: RepResult) -> None:
        self.reps.append(rep)

    def summary(self) -> dict:
        counted = [r for r in self.reps if r.counted]
        faults = Counter(f for r in self.reps for f in r.faults)
        return {
            "exercise": self.exercise,
            "started": self.started.isoformat(timespec="seconds"),
            "reps": len(counted),
            "clean_reps": sum(r.clean for r in counted),
            "partial_reps": sum(not r.counted for r in self.reps),
            "faults": dict(faults),
            "avg_down_s": round(mean(r.eccentric_s for r in counted), 2) if counted else None,
            "avg_up_s": round(mean(r.concentric_s for r in counted), 2) if counted else None,
        }

    def format_summary(self) -> str:
        s = self.summary()
        lines = [
            f"{s['exercise']}: {s['reps']} reps ({s['clean_reps']} clean, "
            f"{s['partial_reps']} not counted)",
        ]
        if s["avg_down_s"] is not None:
            lines.append(f"Tempo: {s['avg_down_s']}s down / {s['avg_up_s']}s up")
        for fault, n in sorted(s["faults"].items(), key=lambda kv: -kv[1]):
            lines.append(f"  {fault}: {n}")
        return "\n".join(lines)

    def save(self, directory: str | Path = "sessions") -> Path:
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.started:%Y%m%d-%H%M%S}-{self.exercise}.json"
        data = {"summary": self.summary(), "reps": [asdict(r) for r in self.reps]}
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return path
