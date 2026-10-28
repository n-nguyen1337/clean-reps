"""State machine and rule engine tests driven by synthetic metric streams."""

import numpy as np
import pytest

from cleanreps.exercises import EXERCISES, Body, Cue, Exercise, ExerciseConfig, Phase, Rule
from cleanreps.exercises.base import quantile
from cleanreps.feedback import CueManager
from cleanreps.session import Session

FPS = 30


class FakeExercise(Exercise):
    """Takes a metrics dict in place of a PoseFrame."""

    key = "fake"
    METRICS = ("angle", "lean")

    def compute_metrics(self, pose):
        return pose


def make_exercise(*rules: Rule, ready_s: float = 0, **options) -> FakeExercise:
    cfg = ExerciseConfig(
        name="Fake", primary_metric="angle", top_threshold=160, bottom_threshold=110,
        hysteresis=8, min_excursion=25, ready_s=ready_s, partial_cue="Go deeper", rules=rules, **options,
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


def test_no_rep_rule_stops_rep_counting():
    hinge = Rule(id="hinge", metric="lean", aggregate="max", max=100, no_rep=True, cue="Hips back", priority=3)
    ex = make_exercise(hinge)
    angles = rep_curve(90)
    updates = run(ex, np.concatenate([angles, angles]), np.concatenate([np.full(60, 150.0), np.full(60, 60.0)]))
    blocked, good = completed(updates)
    assert not blocked.counted and blocked.index is None and blocked.faults == ["hinge"]
    assert good.clean and good.index == 1
    assert ex.reps == 1
    assert [c.id for u in updates[:60] for c in u.cues] == ["hinge"]


def test_blocked_rep_reports_only_why_it_did_not_count():
    depth = Rule(id="depth", metric="angle", aggregate="min", max=100, cue="Deeper", priority=3)
    hinge = Rule(id="hinge", metric="lean", aggregate="max", max=100, no_rep=True, cue="Hips back", priority=3)
    ex = make_exercise(depth, hinge)
    updates = run(ex, rep_curve(105), np.full(60, 150.0))  # shallow, and not the exercise
    (rep,) = completed(updates)
    assert not rep.counted and rep.faults == ["hinge"]
    assert [c.id for u in updates for c in u.cues] == ["hinge"]


def test_partial_that_is_not_the_exercise_is_dropped():
    hinge = Rule(id="hinge", metric="lean", aggregate="max", max=100, no_rep=True, cue="Hips back", priority=3)
    ex = make_exercise(hinge)
    updates = run(ex, rep_curve(125), np.full(60, 150.0))  # like walking up to the camera
    assert completed(updates) == []
    assert not any(u.cues for u in updates)


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


def test_waits_for_the_user_to_settle_at_the_top():
    ex = make_exercise(ready_s=1.0)
    getting_up = np.linspace(60, 175, 30)  # rising from a crouch at the camera
    brief = np.full(9, 175.0)  # with the end of getting up, under 1 s at the top
    updates = run(ex, np.concatenate([getting_up, brief, rep_curve(90)]))
    assert completed(updates) == []
    assert not any(u.cues for u in updates)
    assert not updates[-1].ready

    updates = run(ex, np.concatenate([np.full(30, 175.0), rep_curve(90)]), start_t=99 / FPS)
    assert updates[-1].ready
    (rep,) = completed(updates)
    assert rep.counted and rep.index == 1


def test_settles_again_after_losing_tracking():
    ex = make_exercise(ready_s=1.0)
    run(ex, np.full(40, 175.0))
    assert ex.ready
    gone = [ex.update(None, (40 + i) / FPS) for i in range(90)]
    assert not gone[-1].ready
    assert completed(run(ex, rep_curve(90), start_t=130 / FPS)) == []


def test_learns_the_top_from_how_the_user_stands():
    ex = make_exercise(ready_s=1.0, top_margin=10, top_floor=130)
    run(ex, np.full(31, 156.0))  # stands at 156 while settling
    assert ex.ready and ex.standing == 156 and ex.top == 146
    # Each rep only comes back up to 155: under the configured 160, over the learned 146.
    reps = completed(run(ex, np.concatenate([rep_curve(90, high=155)] * 3), start_t=31 / FPS))
    assert [r.counted for r in reps] == [True] * 3


def test_partial_reps_measure_depth_from_standing():
    ex = make_exercise(ready_s=1.0, top_margin=10, top_floor=130)
    run(ex, np.full(31, 160.0))
    assert ex.top == 150
    # 28 below standing is a real attempt, though only 18 below the learned top.
    (rep,) = completed(run(ex, rep_curve(132, high=160), start_t=31 / FPS))
    assert not rep.counted and rep.faults == ["partial"]


def test_quantile_matches_numpy():
    values = [3.0, 1.0, 4.0, 1.5, 9.0, 2.6]
    for q in (0, 0.25, 0.5, 0.9, 1):
        assert quantile(values, q) == pytest.approx(float(np.quantile(values, q)))


def test_learned_top_stays_within_its_limits():
    tall = make_exercise(ready_s=1.0, top_margin=10, top_floor=145)
    run(tall, np.full(31, 178.0))
    assert tall.top == 160  # never stricter than configured
    bent = make_exercise(ready_s=1.0, top_margin=10, top_floor=145)
    run(bent, np.full(31, 153.0))
    assert bent.top == 145


def test_relearns_the_top_after_losing_tracking():
    ex = make_exercise(ready_s=1.0, top_margin=10, top_floor=130)
    run(ex, np.full(31, 170.0))
    assert ex.top == 160
    for i in range(90):
        ex.update(None, (31 + i) / FPS)
    assert not ex.ready and ex.standing is None
    run(ex, np.full(31, 156.0), start_t=121 / FPS)
    assert ex.top == 146


def test_top_margin_needs_a_sensible_floor(tmp_path):
    base = "name: X\nprimary_metric: a\ntop_threshold: 160\nbottom_threshold: 120\ntop_margin: 10\n"
    for extra in ("", "top_floor: 125\n", "top_floor: 165\n"):
        path = tmp_path / "x.yaml"
        path.write_text(base + extra)
        with pytest.raises(ValueError, match="top_floor"):
            ExerciseConfig.from_yaml(path)


def test_unknown_metric_in_config_rejected():
    with pytest.raises(ValueError):
        make_exercise(Rule(id="x", metric="nope", cue="x", max=1))


@pytest.mark.parametrize("key", sorted(EXERCISES))
def test_bundled_configs_load(key):
    ex = EXERCISES[key]()
    assert ex.config.rules


def lean_limit(body: Body | None) -> float:
    rules = {r.id: r for r in EXERCISES["squat"](body=body).config.rules}
    assert rules["depth"].max == 0.58  # proportions only move the rules they name
    return rules["torso_lean"].max


def test_squat_lean_limit_follows_proportions():
    assert lean_limit(None) == lean_limit(Body()) == 50
    assert lean_limit(Body(femur="long", torso="short")) == 65
    assert lean_limit(Body(femur="short", torso="long")) == 40
    assert lean_limit(Body(femur="long", torso="long")) == 53


def test_proportions_shift_both_limits():
    cfg = make_exercise(Rule(id="lean", metric="lean", cue="x", min=10, max=40)).config
    cfg = ExerciseConfig(**{**cfg.__dict__, "proportions": {"femur": {"long": {"lean": 5}}}})
    rule = cfg.for_body(Body(femur="long")).rules[0]
    assert (rule.min, rule.max) == (15, 45)


def test_bad_body_rejected():
    with pytest.raises(ValueError):
        Body(femur="huge")


def test_proportions_for_unknown_rule_rejected(tmp_path):
    path = tmp_path / "x.yaml"
    path.write_text(
        "name: X\nprimary_metric: a\ntop_threshold: 160\nbottom_threshold: 100\n"
        "proportions: {femur: {long: {nope: 5}}}\n"
    )
    with pytest.raises(ValueError, match="unknown rules"):
        ExerciseConfig.from_yaml(path)


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
