"""End-to-end regression tests on labeled clips in ``tests/clips/``.

Add a phone clip with ``tools/import_lab.py`` (see ``cleanreps/labels.py`` for
the label format), or record one here with
``python -m cleanreps -e squat --record tests/clips/squat_good.mp4`` and write
its ``squat_good.json`` sidecar by hand.

Clips with cached landmarks replay without the pose model. Labels still marked
``"draft"`` are skipped until reviewed.
"""

from pathlib import Path

import pytest

from cleanreps.labels import compare, labeled_reps, load_landmarks, read_json, replay_landmarks

DIR = Path(__file__).parent / "clips"
LABELS = sorted(p for p in DIR.glob("*.json") if not p.name.endswith(".landmarks.json"))
VIDEO_SUFFIXES = (".mp4", ".webm")


def run(label: Path, exercise: str):
    landmarks = label.with_name(f"{label.stem}.landmarks.json.gz")
    if landmarks.exists():
        return replay_landmarks(load_landmarks(landmarks), exercise)
    for suffix in VIDEO_SUFFIXES:
        if (video := label.with_suffix(suffix)).exists():
            from cleanreps.pipeline import replay  # loads the pose model

            return replay(video, exercise)
    pytest.skip("no landmarks or video for this label")


@pytest.mark.skipif(not LABELS, reason="no labeled clips in tests/clips")
@pytest.mark.parametrize("label", LABELS, ids=lambda p: p.stem)
def test_clip(label: Path):
    expected = read_json(label)
    if expected.get("draft"):
        pytest.skip('draft labels: review them, then remove "draft"')
    session = run(label, expected["exercise"])

    reps = labeled_reps(expected)
    if reps is not None:
        problems = compare(session.reps, reps)
        assert not problems, "\n".join(problems)
    else:
        summary = session.summary()
        assert summary["reps"] == expected["reps"]
        assert summary["faults"] == expected.get("faults", {})
