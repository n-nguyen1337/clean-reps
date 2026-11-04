import numpy as np
import pytest

from cleanreps.filters import OneEuroFilter, SkeletonFilter
from cleanreps.geometry import angle, angle_from_vertical, elevation, line_offset


def test_angle_right_angle_2d_and_3d():
    assert angle([1, 0], [0, 0], [0, 1]) == pytest.approx(90)
    assert angle([1, 0, 0], [0, 0, 0], [0, 0, 1]) == pytest.approx(90)


def test_angle_straight_line():
    assert angle([0, 0], [1, 0], [2, 0]) == pytest.approx(180)


def test_angle_degenerate_is_nan():
    assert np.isnan(angle([0, 0], [0, 0], [1, 1]))


def test_angle_from_vertical_image_coords():
    hip = np.array([100, 200])
    assert angle_from_vertical(hip, [100, 100]) == pytest.approx(0)    # upright
    assert angle_from_vertical(hip, [200, 200]) == pytest.approx(90)   # horizontal
    assert angle_from_vertical(hip, [100, 300]) == pytest.approx(180)  # straight down
    assert angle_from_vertical(hip, [0, 100]) == pytest.approx(45)     # leaning either way


def test_elevation_with_y_pointing_down():
    knee = np.array([0, 40, 0])
    assert elevation(knee, [0, 0, 0]) == pytest.approx(90)     # directly above
    assert elevation(knee, [0, 40, 40]) == pytest.approx(0)    # level, whichever way it points
    assert elevation(knee, [40, 40, 0]) == pytest.approx(0)
    assert elevation(knee, [0, 80, 40]) == pytest.approx(-45)  # below
    assert np.isnan(elevation(knee, knee))


@pytest.mark.parametrize("facing", [1, -1])
def test_line_offset_sign_independent_of_facing(facing):
    shoulder, ankle = np.array([0, 100]), np.array([200 * facing, 100])
    sag = np.array([100 * facing, 120])
    pike = np.array([100 * facing, 80])
    assert line_offset(sag, shoulder, ankle) == pytest.approx(0.1)
    assert line_offset(pike, shoulder, ankle) == pytest.approx(-0.1)


def test_one_euro_first_sample_passes_through():
    f = OneEuroFilter()
    x = np.array([1.0, 2.0])
    assert np.allclose(f(x, 0.0), x)


def test_one_euro_reduces_jitter():
    rng = np.random.default_rng(0)
    f = OneEuroFilter(min_cutoff=1.0, beta=0.0)
    noisy = 10 + rng.normal(0, 1, 300)
    smoothed = np.array([f(np.array([v]), i / 30)[0] for i, v in enumerate(noisy)])
    assert smoothed[50:].std() < noisy[50:].std() / 2


def test_one_euro_tracks_step_eventually():
    f = OneEuroFilter(min_cutoff=1.0, beta=0.5)
    f(np.array([0.0]), 0.0)
    out = [f(np.array([100.0]), i / 30)[0] for i in range(1, 60)]
    assert out[-1] == pytest.approx(100, abs=1)


# Shared with the TS port's test in web/src/engine/__tests__/skeleton.test.ts: 3 joints at 30 fps,
# joint 1 thrown for one frame and then really moved, joint 2 fading in and out.
SKELETON_INPUT = [
    ([[100, 200], [300, 400], [500, 600]], [.9, .9, .2]),
    ([[102, 203], [300, 401], [500, 600]], [.9, .9, .3]),
    ([[106, 209], [420, 401], [501, 601]], [.9, .9, .4]),
    ([[112, 218], [300, 402], [501, 600]], [.9, .9, .5]),
    ([[120, 230], [301, 402], [500, 601]], [.9, .9, .6]),
    ([[130, 245], [301, 403], [500, 600]], [.9, .9, .5]),
    ([[140, 260], [450, 403], [500, 600]], [.9, .9, .4]),
    ([[150, 275], [450, 403], [500, 600]], [.9, .9, .3]),
    ([[160, 290], [450, 403], [500, 600]], [.9, .9, .2]),
    ([[170, 305], [450, 403], [500, 600]], [.9, .9, .1]),
]
SKELETON_OUTPUT = [
    None,
    None,
    ([100.0, 200.0, 300.0, 400.0, 500.0, 600.0], [1.0, 1.0, 0.0]),
    ([102.187724, 203.281586, 300.0, 400.341894, 500.113965, 600.0], [1.0, 1.0, 0.0]),
    ([106.922887, 210.38433, 300.051749, 400.751897, 500.292353, 600.134656], [1.0, 1.0, 0.147609]),
    ([112.957739, 219.436609, 300.190003, 401.255591, 500.370055, 600.193309], [1.0, 1.0, 0.399251]),
    ([120.719935, 231.079902, 300.424038, 401.730194, 500.355221, 600.204989], [1.0, 1.0, 0.576603]),
    ([129.811022, 244.716532, 316.922797, 402.637965, 500.273242, 600.173462], [1.0, 1.0, 0.701597]),
    ([139.573036, 259.359554, 350.136293, 402.884945, 500.203152, 600.128967], [1.0, 1.0, 0.642082]),
    ([149.563063, 274.344595, 399.54435, 402.998192, 500.15505, 600.098431], [1.0, 1.0, 0.452528]),
]
ONE_JOINT = np.array([1.0])


def joint_at(*points):
    """Run one joint through the filter at 30 fps. Returns its x per output frame."""
    f = SkeletonFilter()
    results = [f(np.array([[x, 100.0]]), ONE_JOINT, i / 30) for i, x in enumerate(points)]
    return [r[0][0, 0] for r in results if r is not None]


class TestSkeletonFilter:
    def test_matches_the_values_shared_with_the_web_port(self):
        f = SkeletonFilter()
        for i, ((xy, vis), want) in enumerate(zip(SKELETON_INPUT, SKELETON_OUTPUT)):
            out = f(np.array(xy, float), np.array(vis), i / 30)
            if want is None:
                assert out is None
                continue
            assert out[0].ravel() == pytest.approx(want[0], abs=1e-5)
            assert out[1] == pytest.approx(want[1], abs=1e-5)
            assert out[2] == pytest.approx((i - f.ahead) / 30)

    def test_doesnt_trail_steady_movement(self):
        out = joint_at(*(100.0 + 10 * i for i in range(20)))
        assert out[-1] == pytest.approx(100.0 + 10 * 17, abs=1)  # the frame two before the last

    def test_settles_a_still_joint_that_shakes(self):
        out = joint_at(*(100.0 + (-1) ** i for i in range(40)))
        assert max(out[20:]) - min(out[20:]) < 0.2

    def test_ignores_a_large_one_frame_throw(self):
        out = joint_at(100, 100, 100, 100, 400, 100, 100, 100, 100)
        assert out == pytest.approx([100] * len(out))

    def test_shrugs_off_a_smaller_one_frame_throw(self):
        out = joint_at(100, 100, 100, 100, 100, 140, 100, 100, 100, 100, 100)
        assert max(out) < 106

    def test_accepts_a_jump_that_stays(self):
        out = joint_at(*([100.0] * 5 + [400.0] * 8))
        assert out[-1] > 390

    def test_a_stall_widens_the_jump_limit(self):
        f = SkeletonFilter(ahead=0)
        f(np.array([[100.0, 100.0]]), ONE_JOINT, 0.0)
        out = f(np.array([[250.0, 100.0]]), ONE_JOINT, 0.25)
        assert out[0][0, 0] == pytest.approx(250)

    def test_doesnt_smooth_across_a_stall(self):
        f = SkeletonFilter()
        times = [0, 1 / 30, 2 / 30, 0.5, 0.5 + 1 / 30, 0.5 + 2 / 30]
        results = [f(np.array([[x, 100.0]]), ONE_JOINT, t) for x, t in zip((100, 100, 100, 300, 300, 300), times)]
        assert results[4][0][0, 0] == pytest.approx(100)  # the last frame before the stall
        assert results[5][0][0, 0] == pytest.approx(300)  # the first after it

    def test_settings_mean_the_same_at_any_resolution(self):
        def run(long_side: float) -> np.ndarray:
            f = SkeletonFilter()
            scale = long_side / 1280
            out = None
            for i, (xy, vis) in enumerate(SKELETON_INPUT):
                out = f(np.array(xy, float) * scale, np.array(vis), i / 30, long_side)
            return out[0] / scale

        assert run(640.0) == pytest.approx(run(1280.0))

    def test_a_frame_with_no_pose_comes_out_in_turn(self):
        f = SkeletonFilter()
        at = lambda x, t: f(np.array([[x, 100.0]]), ONE_JOINT, t)
        assert at(100.0, 0.0) is None
        assert f(None, None, 1 / 30) is None
        assert at(110.0, 2 / 30)[0][0, 0] == pytest.approx(100)
        assert at(120.0, 3 / 30)[:2] == (None, None)  # the missing frame, in its place
        assert at(130.0, 4 / 30)[0][0, 0] == pytest.approx(110)  # nothing from before the gap

    def test_a_joint_fades_rather_than_blinks(self):
        f = SkeletonFilter()
        seen = [r[1][0] for i, v in enumerate([1.0] * 10 + [0.0] * 40)
                if (r := f(np.array([[100.0, 100.0]]), np.array([v]), i / 30)) is not None]
        steps = np.abs(np.diff(seen))
        assert seen[0] == 1 and seen[-1] < 0.01
        assert steps.max() < 0.3

    def test_reset_starts_over(self):
        f = SkeletonFilter()
        for i in range(5):
            f(np.array([[100.0, 100.0]]), ONE_JOINT, i / 30)
        f.reset()
        assert f(np.array([[400.0, 100.0]]), ONE_JOINT, 6 / 30) is None
