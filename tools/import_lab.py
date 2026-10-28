"""Import clips exported from the web app's lab mode into the labeled clip set.

    python tools/import_lab.py ~/Downloads/20261028-143005-squat.lab.json --person p2 --split tune

For each export this writes, into ``tests/clips/`` by default:

- ``<name>.landmarks.json.gz``: the raw landmarks the phone saw (overwritten on re-import)
- ``<name>.json``: draft labels from the engine's verdicts. Never overwritten
  unless ``--force``, so corrections survive a re-import.
- ``<name>.mp4`` (or ``.webm``): the video, if it sits next to the export. Gitignored.

Then watch the video, fix the labels, and delete the ``"draft": true`` line.
Until then the clip test skips the clip.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from cleanreps.exercises import EXERCISES
from cleanreps.labels import load_landmarks, read_json, replay_landmarks, write_json

FORMAT = "cleanreps-lab/1"
SUFFIX = ".lab.json"


def import_export(path: Path, out: Path, person: str | None, split: str | None, force: bool) -> list[str]:
    data = read_json(path)
    if data.get("format") != FORMAT:
        raise ValueError(f"{path.name}: not a lab export (format {data.get('format')!r}, expected {FORMAT!r})")
    if data["exercise"] not in EXERCISES:
        raise ValueError(f"{path.name}: unknown exercise {data['exercise']!r}")
    name = path.name.removesuffix(SUFFIX) if path.name.endswith(SUFFIX) else path.stem
    out.mkdir(parents=True, exist_ok=True)
    notes = []

    labels, engine = data.pop("labels"), data.pop("engine")
    cache = out / f"{name}.landmarks.json.gz"
    write_json(cache, {"source": "browser", **data})
    notes.append(f"{cache.name}: {len(data['frames'])} frames, {data['model']} model")

    # The Python engine should see what the phone saw; a difference means the engines have drifted.
    replayed = replay_landmarks(load_landmarks(cache), data["exercise"])
    if [(r.counted, sorted(r.faults)) for r in replayed.reps] != [(r["counted"], sorted(r["faults"])) for r in engine]:
        notes.append("warning: the Python engine disagrees with the phone on this clip; check the parity tests")

    label_path = out / f"{name}.json"
    if label_path.exists() and not force:
        notes.append(f"{label_path.name}: kept (already exists; --force to replace)")
    else:
        labels.update({k: v for k, v in (("person", person), ("split", split)) if v is not None})
        write_json(label_path, labels, indent=2)
        notes.append(f"{label_path.name}: {len(labels['reps'])} draft reps, review then remove \"draft\"")

    video = data.get("video")
    source = video and path.with_name(video["file"])
    if source and source.exists():
        target = out / f"{name}{source.suffix}"
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        notes.append(f"{target.name}: video")
    elif video:
        notes.append(f"no video: {video['file']} isn't next to the export")
    return notes


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("exports", nargs="+", type=Path, help=f"*{SUFFIX} files from the web app")
    p.add_argument("-o", "--out", type=Path, default=Path("tests/clips"))
    p.add_argument("--person", help="who is in the clip, as an ID like p2 (never a name)")
    p.add_argument("--split", choices=("tune", "check"), help="tuning set or held-out check set")
    p.add_argument("--force", action="store_true", help="replace existing labels with fresh drafts")
    args = p.parse_args(argv)
    for path in args.exports:
        print(path.name)
        for note in import_export(path, args.out, args.person, args.split, args.force):
            print(f"  {note}")


if __name__ == "__main__":
    main()
