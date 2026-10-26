# cleanReps

Real-time exercise form feedback from a webcam, using OpenCV and MediaPipe Pose. It counts reps, checks form against per-exercise rules, and gives on-screen and spoken cues. See [PLAN.md](PLAN.md) for the roadmap.

## Setup

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows; use .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
```

The pose model (~9 MB) downloads to `models/` on first run.

## Usage

```bash
python -m cleanreps -e squat -s 0          # webcam 0, squat
python -m cleanreps -e pushup -m lite      # faster, less accurate model
python -m cleanreps -e curl --no-audio
python -m cleanreps -e squat --record      # also save raw video to recordings/
python -m cleanreps -e squat -s clip.mp4 --headless   # replay a clip, print summary
python -m cleanreps --web                  # browser viewer for clips in vids/ (http://127.0.0.1:8000)
```

Keys: `q`/`Esc` quit, `r` reset reps. A JSON session log is written to `sessions/` when you quit.

Supported exercises: `squat`, `pushup`, `curl`. Each prints the camera angle it needs at startup.

### Demo site

Live demo: https://n-nguyen1337.github.io/clean-reps/ (pre-rendered; served from the `gh-pages` branch).

To rebuild it, export the clips to a static folder and push that folder to `gh-pages`. Only the annotated frames are published, not the source videos, so only use clips you're licensed to share.

```bash
python -m cleanreps --export-site site --clips vids/7426039-uhd_3840_2160_30fps.mp4
cd site && git init -b gh-pages && git add -A && git commit -m "Deploy demo" \
  && git push -f https://github.com/n-nguyen1337/clean-reps.git gh-pages
```

## How it works

```
VideoSource → PoseEstimator → PoseSmoother → Exercise.update → CueManager → overlay / speech
              (MediaPipe)     (One Euro)     (metrics, reps,   (priority,
                                              rules)            cooldown)
```

- **Metrics**: each exercise computes named metrics per frame ([cleanreps/exercises/](cleanreps/exercises/)). Joint angles use MediaPipe's 3D world landmarks; alignment checks use image coordinates.
- **Reps**: one primary metric drives a `top → descending → bottom → ascending` state machine with hysteresis. Movements that never reach the bottom are reported as partial reps.
- **Rules**: thresholds live in YAML ([cleanreps/rules/](cleanreps/rules/)). Live rules cue during the rep; rules with `aggregate: min|max` are checked when the rep ends.

## Tests

```bash
pytest
```

Unit tests use synthetic metric streams. For end-to-end regression tests, record clips into `tests/clips/` with a JSON label next to each (see [tests/test_replay_clips.py](tests/test_replay_clips.py)).

Not medical advice. Thresholds are starting points; tune them for your body and camera.
