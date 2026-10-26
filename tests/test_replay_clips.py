"""End-to-end regression tests on recorded clips.

Add a clip with ``python -m cleanreps -e squat --record tests/clips/squat_good.mp4``
and a sidecar ``squat_good.json`` describing what should be detected:

    {"exercise": "squat", "reps": 5, "faults": {"depth": 2}}

``faults`` lists the expected count per fault id; ids not listed must not appear.
"""

import json
from pathlib import Path

import pytest

from cleanreps.pipeline import replay

CLIPS = sorted((Path(__file__).parent / "clips").glob("*.json"))


@pytest.mark.skipif(not CLIPS, reason="no labeled clips in tests/clips")
@pytest.mark.parametrize("label", CLIPS, ids=lambda p: p.stem)
def test_clip(label: Path):
    expected = json.loads(label.read_text())
    summary = replay(label.with_suffix(".mp4"), expected["exercise"]).summary()
    assert summary["reps"] == expected["reps"]
    assert summary["faults"] == expected.get("faults", {})
