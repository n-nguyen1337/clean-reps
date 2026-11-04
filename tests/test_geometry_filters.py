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
# joint 1 thrown for one frame and then really moved, joint 2 hovering at the confidence limit.
SKELETON_INPUT = [
    ([[100, 200], [300, 400], [500, 600]], [.9, .9, .45]),
    ([[102, 203], [300, 401], [500, 600]], [.9, .9, .55]),
    ([[106, 209], [420, 401], [501, 601]], [.9, .9, .45]),
    ([[112, 218], [300, 402], [501, 600]], [.9, .9, .35]),
    ([[120, 230], [301, 402], [500, 601]], [.9, .9, .25]),
    ([[130, 245], [301, 403], [500, 600]], [.9, .9, .45]),
    ([[130, 245], [450, 403], [500, 600]], [.9, .9, .55]),
    ([[130, 245], [450, 403], [500, 600]], [.9, .9, .55]),
]
SKELETON_OUTPUT = [
    ([100.0, 200.0, 300.0, 400.0, 500.0, 600.0], [1, 1, 0]),
    ([100.586052, 200.879078, 300.0, 400.254834, 500.0, 600.0], [1, 1, 1]),
    ([102.744195, 204.116292, 300.0, 400.257739, 500.261179, 600.261179], [1, 1, 1]),
    ([107.537867, 211.3068, 300.0, 400.735351, 500.458248, 600.195614], [1, 1, 1]),
    ([115.310405, 222.965608, 300.284713, 401.10585, 500.344411, 600.405122], [1, 1, 0]),
    ([125.753785, 238.630678, 300.505788, 401.692477, 500.261488, 600.30884], [1, 1, 0]),
    ([130.095934, 245.143901, 300.522905, 401.73947, 500.198056, 600.234195], [1, 1, 1]),
    ([131.604187, 247.40628, 422.794704, 402.774961, 500.149193, 600.176532], [1, 1, 1]),
]


class TestSkeletonFilter:
    def test_matches_the_values_shared_with_the_web_port(self):
        f = SkeletonFilter()
        for i, ((xy, vis), (want_xy, want_shown)) in enumerate(zip(SKELETON_INPUT, SKELETON_OUTPUT)):
            out, shown = f(np.array(xy, float), np.array(vis), i / 30)
            assert out.ravel() == pytest.approx(want_xy, abs=1e-5)
            assert shown.astype(int).tolist() == want_shown

    def test_holds_a_one_frame_throw(self):
        f = SkeletonFilter()
        vis = np.array([1.0])
        f(np.array([[100.0, 100.0]]), vis, 0.0)
        thrown, _ = f(np.array([[400.0, 100.0]]), vis, 1 / 30)
        back, _ = f(np.array([[100.0, 100.0]]), vis, 2 / 30)
        assert thrown[0, 0] == pytest.approx(100)
        assert back[0, 0] == pytest.approx(100)

    def test_accepts_a_jump_that_stays(self):
        f = SkeletonFilter()
        vis = np.array([1.0])
        f(np.array([[100.0, 100.0]]), vis, 0.0)
        f(np.array([[400.0, 100.0]]), vis, 1 / 30)
        moved, _ = f(np.array([[400.0, 100.0]]), vis, 2 / 30)
        assert moved[0, 0] > 300

    def test_a_stall_widens_the_jump_limit(self):
        f = SkeletonFilter()
        vis = np.array([1.0])
        f(np.array([[100.0, 100.0]]), vis, 0.0)
        out, _ = f(np.array([[250.0, 100.0]]), vis, 0.25)
        assert out[0, 0] > 150

    def test_settings_mean_the_same_at_any_resolution(self):
        def run(long_side: float) -> np.ndarray:
            f = SkeletonFilter()
            scale = long_side / 1280
            out = None
            for i, (xy, vis) in enumerate(SKELETON_INPUT):
                out, _ = f(np.array(xy, float) * scale, np.array(vis), i / 30, long_side)
            return out / scale

        assert run(640.0) == pytest.approx(run(1280.0))

    def test_reset_starts_over(self):
        f = SkeletonFilter()
        vis = np.array([1.0])
        f(np.array([[100.0, 100.0]]), vis, 0.0)
        f.reset()
        out, _ = f(np.array([[400.0, 100.0]]), vis, 1 / 30)
        assert out[0, 0] == pytest.approx(400)
