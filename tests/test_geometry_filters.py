import numpy as np
import pytest

from cleanreps.filters import OneEuroFilter
from cleanreps.geometry import angle, angle_from_vertical, line_offset


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
