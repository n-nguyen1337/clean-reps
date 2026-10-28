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

A rule with ``no_rep: true`` also stops the rep from counting when it fires,
for movements that aren't the exercise at all (a squat with no hip bend).
Such a rep reports only the ``no_rep`` faults: "squat deeper" means nothing
to someone who wasn't squatting. A dip that never reached the bottom and that
a ``no_rep`` rule would block isn't reported at all, so walking up to the
camera isn't a partial rep.

Nothing counts until the user has held the top position, tracked, for
``ready_s``: getting up from the camera or walking into place isn't a rep.
Losing tracking for ``LOST_ABORT_AFTER_S`` makes them settle again.

With ``top_margin`` set, the top threshold is learned from how the user
stands while settling: the lower quartile of their primary metric minus the
margin, kept between ``top_floor`` and ``top_threshold``. The same straight
leg can measure 10 degrees apart between a front and a side view, so a fixed
top is either too strict for one or too loose for the other. The lower
quartile, not the median, because people often stand extra tall while
settling and relax between reps. Partial reps still measure their depth from
standing (at most ``top_threshold``), not from the lower learned top.

An optional ``proportions`` section shifts rule limits for the user's body
proportions (see ``Body``).
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path

import yaml

from ..pose import PoseFrame

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"
STANDING_QUANTILE = 0.25
LOST_CUE_AFTER_S = 1.0
LOST_ABORT_AFTER_S = 2.0
BODY_SEGMENTS = ("femur", "torso")
BODY_SIZES = ("short", "average", "long")


def quantile(values: list[float], q: float) -> float:
    """Linear interpolation between closest ranks, as numpy's default."""
    s = sorted(values)
    pos = q * (len(s) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


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
    no_rep: bool = False  # a rep with this fault doesn't count

    def violated(self, value: float | None) -> bool:
        if value is None or math.isnan(value):
            return False
        return (self.min is not None and value < self.min) or (
            self.max is not None and value > self.max
        )


@dataclass(frozen=True)
class Body:
    """The user's limb proportions, relative to average."""

    femur: str = "average"
    torso: str = "average"

    def __post_init__(self):
        for segment in BODY_SEGMENTS:
            if getattr(self, segment) not in BODY_SIZES:
                raise ValueError(f"{segment} must be one of {BODY_SIZES}")


@dataclass(frozen=True)
class ExerciseConfig:
    name: str
    primary_metric: str
    top_threshold: float
    bottom_threshold: float
    hysteresis: float = 8.0
    min_excursion: float = 25.0
    ready_s: float = 0.75  # time at the top, tracked, before the first rep can start
    top_margin: float | None = None  # learn the top as (standing - margin) while settling
    top_floor: float | None = None  # the lowest a learned top can go
    partial_cue: str | None = None
    camera_hint: str = ""
    rules: tuple[Rule, ...] = ()
    # segment -> size -> rule id -> amount added to that rule's min and max
    proportions: dict[str, dict[str, dict[str, float]]] = field(default_factory=dict, hash=False)

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
        if cfg.top_margin is not None and (
            cfg.top_floor is None or not cfg.bottom_threshold < cfg.top_floor - cfg.hysteresis
            or cfg.top_floor > cfg.top_threshold
        ):
            raise ValueError("top_margin needs a top_floor between bottom_threshold + hysteresis and top_threshold")
        rule_ids = {r.id for r in rules}
        for segment, sizes in cfg.proportions.items():
            if segment not in BODY_SEGMENTS:
                raise ValueError(f"proportions: unknown segment {segment!r}")
            for size, shifts in sizes.items():
                if size not in BODY_SIZES:
                    raise ValueError(f"proportions.{segment}: unknown size {size!r}")
                if set(shifts) - rule_ids:
                    raise ValueError(f"proportions.{segment}.{size}: unknown rules {sorted(set(shifts) - rule_ids)}")
        return cfg

    def for_body(self, body: Body) -> ExerciseConfig:
        """This config with rule limits shifted for the given proportions."""
        shift: dict[str, float] = {}
        for segment in BODY_SEGMENTS:
            for rule_id, amount in self.proportions.get(segment, {}).get(getattr(body, segment), {}).items():
                shift[rule_id] = shift.get(rule_id, 0.0) + amount
        rules = tuple(
            replace(
                r,
                min=None if r.min is None else r.min + shift[r.id],
                max=None if r.max is None else r.max + shift[r.id],
            ) if r.id in shift else r
            for r in self.rules
        )
        return replace(self, rules=rules)


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
    ready: bool = True  # False until the user has settled at the top


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

    def __init__(self, config: ExerciseConfig | None = None, body: Body | None = None):
        self.config = config or ExerciseConfig.from_yaml(RULES_DIR / f"{self.key}.yaml")
        if body is not None:
            self.config = self.config.for_body(body)
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
        self._unsettle()

    def _unsettle(self) -> None:
        self.ready = False
        self._settling: list[float] = []  # primary metric while settling
        self._settling_since: float | None = None
        self.top = self.config.top_threshold  # this set's top, learned once settled
        self.standing: float | None = None

    def _settle(self) -> None:
        self.ready = True
        cfg = self.config
        if cfg.top_margin is not None:
            self.standing = quantile(self._settling, STANDING_QUANTILE)
            self.top = min(cfg.top_threshold, max(cfg.top_floor, self.standing - cfg.top_margin))

    def update(self, pose: PoseFrame | None, t: float) -> ExerciseUpdate:
        metrics = self.compute_metrics(pose) if pose is not None else {}
        value = metrics.get(self.config.primary_metric)

        if value is None or math.isnan(value):
            return self._lost(metrics, t)
        self._last_seen = t

        cfg = self.config
        if not self.ready:
            if value < cfg.top_threshold - cfg.hysteresis:
                self._settling_since, self._settling = None, []
            else:
                if self._settling_since is None:
                    self._settling_since = t
                self._settling.append(float(value))
            if self._settling_since is None or t - self._settling_since < cfg.ready_s:
                return ExerciseUpdate(self.phase, self.reps, metrics, True, ready=False)
            self._settle()

        cues: list[Cue] = []
        if self._rep is not None:
            cues += self._rep.observe(metrics, t, self._live_rules)

        completed = None
        if self.phase is Phase.TOP:
            if value < self.top - cfg.hysteresis:
                self.phase = Phase.DESCENDING
                self._rep = _RepTracker(t, cfg.primary_metric)
                cues += self._rep.observe(metrics, t, self._live_rules)
        elif self.phase is Phase.DESCENDING:
            if value <= cfg.bottom_threshold:
                self.phase = Phase.BOTTOM
            elif value >= self.top:
                completed = self._abort(t)
                if completed is not None and cfg.partial_cue:
                    cues.append(Cue("partial", cfg.partial_cue, 3))
        elif self.phase is Phase.BOTTOM:
            if value > cfg.bottom_threshold + cfg.hysteresis:
                self.phase = Phase.ASCENDING
        elif self.phase is Phase.ASCENDING:
            if value <= cfg.bottom_threshold:
                self.phase = Phase.BOTTOM
            elif value >= self.top:
                completed, rep_cues = self._complete(t)
                cues += rep_cues

        return ExerciseUpdate(self.phase, self.reps, metrics, True, cues, completed)

    def _lost(self, metrics, t: float) -> ExerciseUpdate:
        cues = []
        lost_for = t - self._last_seen if self._last_seen is not None else math.inf
        if lost_for >= LOST_CUE_AFTER_S:
            cues.append(Cue("tracking", "Step back so your whole body is visible", 1))
        self._settling_since, self._settling = None, []  # settling needs unbroken tracking
        if lost_for >= LOST_ABORT_AFTER_S and self.ready:
            self.phase, self._rep = Phase.TOP, None
            self._unsettle()  # whoever comes back may stand differently
        return ExerciseUpdate(self.phase, self.reps, metrics, False, cues, ready=self.ready)

    def _broken(self, rep: _RepTracker) -> list[Rule]:
        """Rep rules the rep breaks, judged on each metric's extreme over the rep."""
        broken = []
        for rule in self._rep_rules:
            extreme = rep.extremes.get(rule.metric)
            if extreme is None:
                continue
            value = extreme[0] if rule.aggregate == "min" else extreme[1]
            if rule.violated(value) and rule.id not in rep.faults:
                broken.append(rule)
        return broken

    def _blocking(self, rep: _RepTracker, broken: list[Rule]) -> list[Rule]:
        """The no_rep rules that fired: the movement wasn't the exercise."""
        return [r for r in self.config.rules if r.no_rep and (r in broken or r.id in rep.faults)]

    def _complete(self, t: float) -> tuple[RepResult, list[Cue]]:
        rep, self._rep = self._rep, None
        self.phase = Phase.TOP

        broken = self._broken(rep)
        blocking = self._blocking(rep, broken)
        if blocking:
            # Not the exercise at all: say only why, not how to do it better.
            cues = [Cue(r.id, r.cue, r.priority) for r in blocking if r in broken]
            faults = [r.id for r in blocking]
            return RepResult(False, None, rep.start_s, rep.bottom_s, t, faults, rep.extremes), cues

        rep.faults += [r.id for r in broken]
        cues = [Cue(r.id, r.cue, r.priority) for r in broken]
        self.reps += 1
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
        standing = self.top if self.standing is None else min(self.standing, self.config.top_threshold)
        if standing - lowest < self.config.min_excursion:
            return None
        if self._blocking(rep, self._broken(rep)):
            return None  # not an attempt at the exercise, such as walking up to the camera
        return RepResult(False, None, rep.start_s, rep.bottom_s, t, ["partial"], rep.extremes)
