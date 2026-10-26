"""Exercise base class: rep state machine plus a config-driven rule engine.

Each exercise computes named metrics per frame (joint angles, alignment).
One metric is the *primary* metric that drives rep counting. It must
decrease going into the rep (e.g. knee angle in a squat) and increase
coming out of it.

Rules come from YAML (see ``cleanreps/rules/``). A rule flags a fault when
its metric falls outside ``[min, max]``:

- Live rules (no ``aggregate``) are checked every frame during a rep and
  must be violated for ``min_frames`` consecutive frames. They cue
  immediately.
- Rep rules (``aggregate: min|max``) are checked once, when the rep ends,
  against the metric's extreme over the whole rep.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

import yaml

from ..pose import PoseFrame

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"
LOST_CUE_AFTER_S = 1.0
LOST_ABORT_AFTER_S = 2.0


class Phase(str, Enum):
    TOP = "top"
    DESCENDING = "descending"
    BOTTOM = "bottom"
    ASCENDING = "ascending"


@dataclass(frozen=True)
class Rule:
    id: str
    metric: str
    cue: str
    priority: int = 1
    min: float | None = None
    max: float | None = None
    aggregate: str | None = None  # None (live), "min" or "max"
    min_frames: int = 3

    def violated(self, value: float | None) -> bool:
        if value is None or math.isnan(value):
            return False
        return (self.min is not None and value < self.min) or (
            self.max is not None and value > self.max
        )


@dataclass(frozen=True)
class ExerciseConfig:
    name: str
    primary_metric: str
    top_threshold: float
    bottom_threshold: float
    hysteresis: float = 8.0
    min_excursion: float = 25.0
    partial_cue: str | None = None
    camera_hint: str = ""
    rules: tuple[Rule, ...] = ()

    @classmethod
    def from_yaml(cls, path: str | Path) -> ExerciseConfig:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        rules = tuple(Rule(**r) for r in data.pop("rules", []))
        for rule in rules:
            if rule.aggregate not in (None, "min", "max"):
                raise ValueError(f"rule {rule.id!r}: aggregate must be min or max")
        cfg = cls(rules=rules, **data)
        if cfg.bottom_threshold >= cfg.top_threshold:
            raise ValueError("bottom_threshold must be below top_threshold")
        return cfg


@dataclass(frozen=True)
class Cue:
    id: str
    text: str
    priority: int = 1


@dataclass
class RepResult:
    counted: bool
    index: int | None  # rep number if counted
    start_s: float
    bottom_s: float
    end_s: float
    faults: list[str] = field(default_factory=list)
    extremes: dict[str, tuple[float, float]] = field(default_factory=dict)  # metric -> (min, max)

    @property
    def clean(self) -> bool:
        return self.counted and not self.faults

    @property
    def eccentric_s(self) -> float:
        return self.bottom_s - self.start_s

    @property
    def concentric_s(self) -> float:
        return self.end_s - self.bottom_s


@dataclass
class ExerciseUpdate:
    phase: Phase
    reps: int
    metrics: dict[str, float | None]
    tracking: bool
    cues: list[Cue] = field(default_factory=list)
    completed: RepResult | None = None


class _RepTracker:
    """Accumulates metric extremes and live-rule faults over one rep."""

    def __init__(self, t: float, primary: str):
        self.start_s = t
        self.primary = primary
        self.bottom_s = t
        self.extremes: dict[str, tuple[float, float]] = {}
        self.faults: list[str] = []
        self._streaks: dict[str, int] = {}

    def observe(self, metrics: dict[str, float | None], t: float, live_rules) -> list[Cue]:
        for name, value in metrics.items():
            if value is None or math.isnan(value):
                continue
            value = float(value)  # keep numpy scalars out of the JSON session log
            lo, hi = self.extremes.get(name, (value, value))
            if name == self.primary and value < lo:
                self.bottom_s = t
            self.extremes[name] = (min(lo, value), max(hi, value))

        cues = []
        for rule in live_rules:
            if rule.violated(metrics.get(rule.metric)):
                self._streaks[rule.id] = self._streaks.get(rule.id, 0) + 1
                if self._streaks[rule.id] == rule.min_frames and rule.id not in self.faults:
                    self.faults.append(rule.id)
                    cues.append(Cue(rule.id, rule.cue, rule.priority))
            else:
                self._streaks[rule.id] = 0
        return cues


class Exercise(ABC):
    """Base class. Subclasses set ``key`` and ``METRICS`` and compute metrics."""

    key: str
    METRICS: tuple[str, ...]

    def __init__(self, config: ExerciseConfig | None = None):
        self.config = config or ExerciseConfig.from_yaml(RULES_DIR / f"{self.key}.yaml")
        known = set(self.METRICS)
        unknown = {self.config.primary_metric} - known | {r.metric for r in self.config.rules} - known
        if unknown:
            raise ValueError(f"{self.key}: unknown metrics in config: {sorted(unknown)}")
        self._live_rules = [r for r in self.config.rules if r.aggregate is None]
        self._rep_rules = [r for r in self.config.rules if r.aggregate is not None]
        self.reset()

    @abstractmethod
    def compute_metrics(self, pose: PoseFrame) -> dict[str, float | None]:
        """Per-frame metrics. Use None for metrics that can't be measured."""

    def reset(self) -> None:
        self.phase = Phase.TOP
        self.reps = 0
        self._rep: _RepTracker | None = None
        self._last_seen: float | None = None

    def update(self, pose: PoseFrame | None, t: float) -> ExerciseUpdate:
        metrics = self.compute_metrics(pose) if pose is not None else {}
        value = metrics.get(self.config.primary_metric)

        if value is None or math.isnan(value):
            return self._lost(metrics, t)
        self._last_seen = t

        cues: list[Cue] = []
        if self._rep is not None:
            cues += self._rep.observe(metrics, t, self._live_rules)

        cfg, completed = self.config, None
        if self.phase is Phase.TOP:
            if value < cfg.top_threshold - cfg.hysteresis:
                self.phase = Phase.DESCENDING
                self._rep = _RepTracker(t, cfg.primary_metric)
                cues += self._rep.observe(metrics, t, self._live_rules)
        elif self.phase is Phase.DESCENDING:
            if value <= cfg.bottom_threshold:
                self.phase = Phase.BOTTOM
            elif value >= cfg.top_threshold:
                completed = self._abort(t)
                if completed is not None and cfg.partial_cue:
                    cues.append(Cue("partial", cfg.partial_cue, 3))
        elif self.phase is Phase.BOTTOM:
            if value > cfg.bottom_threshold + cfg.hysteresis:
                self.phase = Phase.ASCENDING
        elif self.phase is Phase.ASCENDING:
            if value <= cfg.bottom_threshold:
                self.phase = Phase.BOTTOM
            elif value >= cfg.top_threshold:
                completed, rep_cues = self._complete(t)
                cues += rep_cues

        return ExerciseUpdate(self.phase, self.reps, metrics, True, cues, completed)

    def _lost(self, metrics, t: float) -> ExerciseUpdate:
        cues = []
        lost_for = t - self._last_seen if self._last_seen is not None else math.inf
        if lost_for >= LOST_CUE_AFTER_S:
            cues.append(Cue("tracking", "Step back so your whole body is visible", 1))
        if lost_for >= LOST_ABORT_AFTER_S and self._rep is not None:
            self.phase, self._rep = Phase.TOP, None
        return ExerciseUpdate(self.phase, self.reps, metrics, False, cues)

    def _complete(self, t: float) -> tuple[RepResult, list[Cue]]:
        rep, self._rep = self._rep, None
        self.phase = Phase.TOP
        self.reps += 1

        cues = []
        for rule in self._rep_rules:
            extreme = rep.extremes.get(rule.metric)
            if extreme is None:
                continue
            value = extreme[0] if rule.aggregate == "min" else extreme[1]
            if rule.violated(value) and rule.id not in rep.faults:
                rep.faults.append(rule.id)
                cues.append(Cue(rule.id, rule.cue, rule.priority))

        result = RepResult(True, self.reps, rep.start_s, rep.bottom_s, t, rep.faults, rep.extremes)
        if result.clean:
            cues.append(Cue("good_rep", "Good rep", 0))
        return result, cues

    def _abort(self, t: float) -> RepResult | None:
        """Back at the top without reaching the bottom: report a partial rep
        if the movement was big enough to be a real attempt."""
        rep, self._rep = self._rep, None
        self.phase = Phase.TOP
        lowest = rep.extremes.get(self.config.primary_metric, (math.inf, math.inf))[0]
        if self.config.top_threshold - lowest < self.config.min_excursion:
            return None
        return RepResult(False, None, rep.start_s, rep.bottom_s, t, ["partial"], rep.extremes)
