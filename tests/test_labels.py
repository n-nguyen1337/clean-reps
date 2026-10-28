"""Label matching, landmark files, and the lab import and fixture export tools."""

import importlib.util
import json
from pathlib import Path

import pytest

from cleanreps.exercises import RepResult
from cleanreps.labels import (
    LabeledRep, compare, labeled_reps, load_landmarks, match_reps, read_json, replay_landmarks, write_json,
)

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = sorted((ROOT / "web" / "fixtures").glob("*.squat.json"))


def tool(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rep(bottom_s: float, counted: bool = True, *faults: str) -> RepResult:
    return RepResult(counted, 1 if counted else None, bottom_s - 1, bottom_s, bottom_s + 1, list(faults))


def lab(bottom_s: float, counted: bool = True, *faults: str) -> LabeledRep:
    return LabeledRep(bottom_s, counted, frozenset(faults))


class TestMatching:
    def test_pairs_by_nearest_bottom(self):
        pairs = match_reps([rep(3.2), rep(6.0)], [lab(6.3), lab(3.0)])
        assert [(r.bottom_s, l.bottom_s) for r, l in pairs] == [(3.2, 3.0), (6.0, 6.3)]

    def test_leaves_far_reps_unmatched(self):
        pairs = match_reps([rep(5.0)], [lab(3.0)])
        assert [(r and r.bottom_s, l and l.bottom_s) for r, l in pairs] == [(None, 3.0), (5.0, None)]

    def test_agreement_has_no_problems(self):
        assert compare([rep(3.0), rep(6.0, True, "depth")], [lab(3.1), lab(5.8, True, "depth")]) == []

    def test_reports_each_kind_of_disagreement(self):
        problems = compare(
            [rep(3.0, True, "depth"), rep(6.0, False, "partial"), rep(12.0)],
            [lab(3.0), lab(6.0), lab(9.0)],
        )
        assert problems == [
            "3.0s: faults depth, expected none",
            "6.0s: not counted, expected counted",
            "6.0s: faults partial, expected none",
            "9.0s: missed rep (expected counted, clean)",
            "12.0s: unexpected counted rep (clean)",
        ]

    def test_an_ignored_non_rep_is_fine(self):
        # A small dip labeled "doesn't count" may never register as a rep at all.
        assert compare([], [lab(4.0, False)]) == []

    def test_totals_only_labels(self):
        assert labeled_reps({"exercise": "squat", "reps": 5}) is None
        assert labeled_reps({"reps": [{"bottom_s": 1.5, "counted": False, "faults": ["partial"]}]}) == [
            lab(1.5, False, "partial")]


def test_landmarks_round_trip(tmp_path: Path):
    path = tmp_path / "x.landmarks.json.gz"
    write_json(path, {"body": {"femur": "long"}, "frames": [{"t": 0.0, "ts": 0, "pose": None}]})
    landmarks = load_landmarks(path)
    assert landmarks.frames == [(0.0, None)]
    assert landmarks.body.femur == "long" and landmarks.body.torso == "average"
    assert replay_landmarks(landmarks, "squat").reps == []


def lab_export(frames: list[dict], engine: list[dict]) -> dict:
    return {
        "format": "cleanreps-lab/1", "exercise": "squat", "model": "lite", "width": 720, "height": 1280,
        "body": {"femur": "average", "torso": "average"},
        "video": {"file": "20261028-143005-squat.mp4", "mimeType": "video/mp4", "offsetS": 0.1, "endS": 9.0},
        "labels": {"draft": True, "exercise": "squat", "person": None, "split": None,
                   "reps": [{"bottom_s": r["bottom_s"], "counted": r["counted"], "faults": r["faults"]} for r in engine]},
        "engine": engine,
        "frames": frames,
    }


class TestImportLab:
    def test_writes_cache_labels_and_video(self, tmp_path: Path):
        src = tmp_path / "phone"
        src.mkdir()
        export = src / "20261028-143005-squat.lab.json"
        export.write_text(json.dumps(lab_export([{"t": 0.0, "ts": 0, "pose": None}], [])))
        (src / "20261028-143005-squat.mp4").write_bytes(b"video")
        out = tmp_path / "clips"

        notes = tool("import_lab").import_export(export, out, "p2", "tune", force=False)

        assert not any("warning" in n for n in notes)
        assert read_json(out / "20261028-143005-squat.json") == {
            "draft": True, "exercise": "squat", "person": "p2", "split": "tune", "reps": []}
        cache = read_json(out / "20261028-143005-squat.landmarks.json.gz")
        assert cache["source"] == "browser" and cache["model"] == "lite" and "labels" not in cache
        assert (out / "20261028-143005-squat.mp4").read_bytes() == b"video"

    def test_keeps_reviewed_labels(self, tmp_path: Path):
        export = tmp_path / "a.lab.json"
        export.write_text(json.dumps(lab_export([], [])))
        out = tmp_path / "clips"
        out.mkdir()
        (out / "a.json").write_text('{"exercise": "squat", "reps": []}')

        notes = tool("import_lab").import_export(export, out, None, None, force=False)

        assert read_json(out / "a.json") == {"exercise": "squat", "reps": []}
        assert any("kept" in n for n in notes)

    def test_rejects_other_files(self, tmp_path: Path):
        path = tmp_path / "b.lab.json"
        path.write_text('{"format": "something-else"}')
        with pytest.raises(ValueError, match="not a lab export"):
            tool("import_lab").import_export(path, tmp_path, None, None, force=False)

    @pytest.mark.skipif(not FIXTURES, reason="no local parity fixtures in web/fixtures")
    def test_real_landmarks_agree_with_engine(self, tmp_path: Path):
        fx = max(map(read_json, FIXTURES), key=lambda fx: fx["frames"][-1]["expected"]["reps"])
        frames = [{k: f[k] for k in ("t", "ts", "pose")} for f in fx["frames"]]
        engine = [f["expected"]["completed"] for f in fx["frames"] if f["expected"]["completed"]]
        export = tmp_path / "c.lab.json"
        export.write_text(json.dumps(lab_export(frames, engine)))

        notes = tool("import_lab").import_export(export, tmp_path / "clips", None, None, force=False)

        assert not any("warning" in n for n in notes)
        assert len(read_json(tmp_path / "clips" / "c.json")["reps"]) == len(engine) > 0


@pytest.mark.skipif(not FIXTURES, reason="no local parity fixtures in web/fixtures")
def test_fixture_export_from_cached_landmarks(tmp_path: Path):
    fx = read_json(FIXTURES[0])
    cache = tmp_path / "clip.landmarks.json.gz"
    write_json(cache, {"width": fx["width"], "height": fx["height"],
                       "frames": [{k: f[k] for k in ("t", "ts", "pose")} for f in fx["frames"]]})

    out = tool("export_fixtures").export(cache, "squat", "full")

    assert [f["expected"] for f in out["frames"]] == [f["expected"] for f in fx["frames"]]
