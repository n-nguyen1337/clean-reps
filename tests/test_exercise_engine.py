"""State machine and rule engine tests driven by synthetic metric streams."""

import numpy as np
import pytest

from cleanreps.exercises import EXERCISES, Cue, Exercise, ExerciseConfig, Phase, Rule
from cleanreps.feedback import CueManager
from cleanreps.session import Session

FPS = 30


class FakeExercise(Exercise):
    """Takes a metrics dict in place of a PoseFrame."""

    key = "fake"
    METRICS = ("angle", "lean")

    def compute_metrics(self, pose):
        return pose


def make_exercise(*rules: Rule) -> FakeExercise:
    cfg = ExerciseConfig(
        name="Fake", primary_metric="angle", top_threshold=160, bottom_threshold=110,
        hysteresis=8, min_excursion=25, partial_cue="Go deeper", rules=rules,
    )
    return FakeExercise(cfg)


def rep_curve(low: float, high: float = 175, frames: int = 60) -> np.ndarray:
    """One smooth rep: high -> low -> high."""
    return low + (high - low) * (np.cos(np.linspace(0, 2 * np.pi, frames)) + 1) / 2


def run(ex: Exercise, angles, lean=None, start_t=0.0):
    updates = []
    for i, a in enumerate(angles):
        metrics = {"angle": float(a), "lean": None if lean is None else float(lean[i])}
        updates.append(ex.update(metrics, start_t + i / FPS))
    return updates


def completed(updates):
    return [u.completed for u in updates if u.completed is not None]


def test_counts_full_reps():
    ex = make_exercise()
    updates = run(ex, np.concatenate([rep_curve(90)] * 3))
    reps = completed(updates)
    assert ex.reps == 3
    assert [r.index for r in reps] == [1, 2, 3]
    assert all(r.clean for r in reps)
    assert ex.phase is Phase.TOP


def test_jitter_near_threshold_does_not_count():
    ex = make_exercise()
    jitter = 160 + np.tile([-3.0, 3.0], 50)  # within hysteresis of the top
    run(ex, jitter)
    assert ex.reps == 0
    assert ex.phase is Phase.TOP


def test_partial_rep_is_reported_not_counted():
    ex = make_exercise()
    updates = run(ex, rep_curve(125))  # never reaches bottom (110)
    (rep,) = completed(updates)
    assert not rep.counted and rep.faults == ["partial"]
    assert ex.reps == 0
    assert any(c.id == "partial" for u in updates for c in u.cues)


def test_small_dip_is_ignored():
    ex = make_exercise()
    updates = run(ex, rep_curve(145))
    assert completed(updates) == []


def test_rep_rule_on_aggregate():
    depth = Rule(id="depth", metric="angle", aggregate="min", max=100, cue="Deeper", priority=3)
    ex = make_exercise(depth)
    shallow, deep = completed(run(ex, np.concatenate([rep_curve(105), rep_curve(90)])))
    assert shallow.counted and shallow.faults == ["depth"]
    assert deep.clean


def test_live_rule_needs_consecutive_frames_and_cues_once():
    lean = Rule(id="lean", metric="lean", max=45, cue="Chest up", min_frames=3)
    ex = make_exercise(lean)
    angles = rep_curve(90)
    leans = np.full(len(angles), 30.0)
    leans[20:22] = 60  # 2 frames: below min_frames, ignored
    (rep,) = completed(run(ex, angles, leans))
    assert rep.clean

    leans[20:30] = 60  # 10 frames: one fault, one cue
    updates = run(ex, angles, leans, start_t=10)
    (rep,) = completed(updates)
    assert rep.faults == ["lean"]
    assert sum(c.id == "lean" for u in updates for c in u.cues) == 1


def test_live_rules_ignored_at_top():
    lean = Rule(id="lean", metric="lean", max=45, cue="Chest up", min_frames=1)
    ex = make_exercise(lean)
    updates = run(ex, np.full(30, 175.0), np.full(30, 80.0))
    assert all(not u.cues for u in updates)


def test_tempo_from_bottom_time():
    ex = make_exercise()
    (rep,) = completed(run(ex, rep_curve(90, frames=61)))
    assert rep.eccentric_s == pytest.approx(rep.concentric_s, abs=0.2)


def test_lost_tracking_cues_then_aborts_rep():
    ex = make_exercise()
    run(ex, rep_curve(90)[:30])
    assert ex.phase is not Phase.TOP
    updates = [ex.update(None, 1.0 + i / FPS) for i in range(90)]
    assert not updates[-1].tracking
    assert any(c.id == "tracking" for c in updates[-1].cues)
    assert ex.phase is Phase.TOP


def test_unknown_metric_in_config_rejected():
    with pytest.raises(ValueError):
        make_exercise(Rule(id="x", metric="nope", cue="x", max=1))


@pytest.mark.parametrize("key", sorted(EXERCISES))
def test_bundled_configs_load(key):
    ex = EXERCISES[key]()
    assert ex.config.rules


def test_cue_manager_priority_and_cooldown():
    cm = CueManager(display_s=2, cooldown_s=4)
    cm.push([Cue("a", "A", 1)], 0.0)
    cm.push([Cue("b", "B", 0)], 0.5)  # lower priority waits
    assert cm.current(0.5).id == "a"
    cm.push([Cue("c", "C", 3)], 1.0)  # higher priority preempts
    assert cm.current(1.0).id == "c"
    assert cm.current(3.5) is None     # expired
    cm.push([Cue("c", "C", 3)], 3.5)  # still in cooldown
    assert cm.current(3.5) is None
    cm.push([Cue("c", "C", 3)], 5.5)
    assert cm.current(5.5).id == "c"


def test_session_summary():
    ex = make_exercise(Rule(id="depth", metric="angle", aggregate="min", max=100, cue="Deeper"))
    session = Session("fake")
    for rep in completed(run(ex, np.concatenate([rep_curve(90), rep_curve(105), rep_curve(125)]))):
        session.add(rep)
    s = session.summary()
    assert (s["reps"], s["clean_reps"], s["partial_reps"]) == (2, 1, 1)
    assert s["faults"] == {"depth": 1, "partial": 1}
