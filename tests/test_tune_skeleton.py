"""The skeleton filter's trade-off on a real phone clip, so a settings change has to be deliberate."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CLIP = ROOT / "tests" / "clips" / "20261028-133501-squat.landmarks.json.gz"


@pytest.fixture(scope="module")
def tune():
    spec = importlib.util.spec_from_file_location("tune_skeleton", ROOT / "tools" / "tune_skeleton.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # its dataclass looks itself up here
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def clip(tune):
    return tune.load_clip(CLIP)


def test_smoother_than_the_old_overlay_and_faster_than_the_engine(tune, clip):
    new = tune.score(clip, tune.apply_skeleton(clip))
    old = tune.score(clip, tune.apply_one_euro(clip, *tune.OLD))
    engine = tune.score(clip, tune.apply_one_euro(clip, *tune.ENGINE))

    assert new["moving_torso"] < old["moving_torso"]
    assert new["still_torso"] < old["still_torso"]
    assert new["hops"] < old["hops"]
    assert new["lag_torso"] < engine["lag_torso"] * 0.6
    assert new["lag_torso"] < 20


def test_hysteresis_cuts_blinking(tune, clip):
    hard, with_hysteresis = tune.blinks(clip)
    assert with_hysteresis <= hard


def test_timing_says_when_a_clip_has_none(tune, clip, capsys):
    tune.timing(clip)
    out = capsys.readouterr().out
    assert "model: not recorded" in out
    assert "camera frames dropped: not recorded" in out
