# cleanReps — Project Plan

| | |
|---|---|
| **Status** | Core implemented; needs testing with real video |
| **Plan version** | 0.2 |
| **Last updated** | 2026-10-26 |

## Concept

A webcam app that tracks your body as you exercise. It counts reps, checks your form against rules for each exercise, and gives you cues on screen and out loud while you train. At the end it shows a summary of the session.

## Core pipeline

```
Webcam (OpenCV) → Pose estimation (MediaPipe) → Smoothing → Features → Exercise logic → Feedback → UI / Audio / Log
```

1. **Capture**: `cv2.VideoCapture`, mirrored preview, FPS counter. Video files use the same interface as the webcam, for replay.
2. **Pose**: MediaPipe's `PoseLandmarker` from the Tasks API (the old `mp.solutions.pose` is legacy). It returns 33 landmarks, each with a visibility score. It also gives 3D "world" landmarks in meters, which make angles more reliable than raw pixel positions.
3. **Smoothing**: a One Euro filter on each landmark to stop the jitter that would otherwise cause false cues.
4. **Features**: joint angles (knee, hip, elbow, shoulder), torso lean, distances and speeds. Landmarks with low visibility are ignored.
5. **Exercise logic**: a state machine per exercise (`TOP → DESCENDING → BOTTOM → ASCENDING → TOP`). It uses separate thresholds for going down and coming up, so small wobbles don't count as reps. Form rules run during each rep and again once it is done.
6. **Feedback**, at three levels:
   - **Live cues** (e.g. "chest up"): one at a time, highest priority first, with a cooldown so they don't spam.
   - **Per-rep verdict**: e.g. "Rep 7: depth ✓, knees caved ✗".
   - **Session summary**: rep count, how often each fault happened, tempo, and range of motion over time.
7. **Output**: an OpenCV overlay (skeleton, angles, rep counter, cue banner), optional text-to-speech, and a CSV/JSON session log.

## Exercises

| Exercise | Best camera view | Key checks |
|---|---|---|
| **Squat** (build first) | Side; front for knees | Depth (hip vs knee), torso lean, knees caving in (front view), heels lifting |
| Push-up | Side | Elbow depth, hips sagging or piking (shoulder–hip–ankle line), full lockout |
| Bicep curl | Front or side | Full range, elbow drifting forward, torso swinging |

Rules and thresholds live in YAML config files, one per exercise, so new exercises can be added without changing the core code.

## Project structure

```
cleanreps/
  capture.py      # camera + video-file sources (same interface)
  pose.py         # MediaPipe PoseLandmarker wrapper
  filters.py      # One Euro filter
  geometry.py     # angles, vectors, normalization
  exercises/      # base class, squat.py, pushup.py, curl.py
  rules/          # YAML thresholds per exercise
  feedback.py     # cue priority, cooldown, TTS
  ui.py           # overlay drawing
  session.py      # logging + summary
  main.py         # CLI: --exercise squat --source 0|video.mp4
tests/            # replay recorded clips, assert rep counts and faults
```

**Stack:** Python 3.11+ (developed on 3.13), venv + pip, `mediapipe==0.10.35`, `opencv-python`, `numpy`, `pyyaml`, `pyttsx3`, `pytest`.

## Milestones

### M0 — Skeleton
- [x] Set up the project and pin dependencies (venv + `pyproject.toml`; uv wasn't installed)
- [x] Webcam feed with mirrored preview and FPS counter
- [x] PoseLandmarker integration with skeleton overlay
- [ ] Compare the lite, full and heavy models for speed vs accuracy and pick one (default: full)

### M1 — Rep counting
- [x] Angle and geometry helpers
- [x] One Euro filter on landmarks
- [x] Squat state machine with hysteresis and partial-rep detection
- [ ] Confirm squat rep counting on live video

### M2 — Form feedback
- [x] Squat form rules (depth, torso lean, knees caving in)
- [ ] Heel-lift rule for squats
- [x] On-screen cue banner with priority and cooldown
- [x] Audio cues (TTS on a background thread)
- [ ] Tune thresholds on live video

### M3 — Replay and tests
- [x] Video-file source, `--record` and `--headless` replay mode
- [ ] Record about 10 labeled clips (good reps plus deliberate faults)
- [x] Regression test harness for labeled clips (`tests/test_replay_clips.py`)
- [x] Unit tests for geometry, filter, state machine, rules, cues and session
- [x] Session log (JSON) and summary

### M4 — More exercises
- [x] Push-up (depth, hip sag, hip pike)
- [x] Bicep curl (full curl, elbow drift, torso swing)
- [x] Refine the exercise base class and YAML rule format
- [ ] Confirm push-up and curl on live video

### M5 — Polish
- [ ] Calibration pose (about 3 s) to capture body proportions
- [ ] Check that the user is at the right angle to the camera
- [ ] Summary screen at the end of a session
- [ ] "Not medical advice" disclaimer

### Later
- [ ] Detect the exercise automatically
- [ ] Score form with a learned model trained on landmark sequences
- [ ] Browser version using MediaPipe's `tasks-vision` JS library
- [ ] Track progress across sessions

## Risks

| Risk | Mitigation |
|---|---|
| A single camera gives 2D angles that shift with camera angle | Tell users which view each exercise needs; use world landmarks |
| Hidden body parts and baggy clothes give low-visibility landmarks | Pause feedback rather than give wrong cues |
| Good thresholds vary by body type | Calibration step; adjustable thresholds |
| Users may treat cues as medical advice | Show a disclaimer in the app |

## Open questions

- [ ] **Platform:** a Python desktop app (current plan) or a browser/mobile app? Product options: [PLAN-web.md](PLAN-web.md), [PLAN-mobile.md](PLAN-mobile.md)
- [ ] **Goal:** a personal tool, a portfolio project, or the seed of a product?
- [ ] **Exercises:** are squat, push-up and curl right, or should others come first (deadlift, overhead press, lunges)?
- [ ] **Feedback:** is on-screen text plus voice enough, or should progress be tracked across sessions?

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-26 | Use the MediaPipe Tasks API (`PoseLandmarker`) | `mp.solutions.pose` is legacy |
| 2026-10-26 | Build the squat first | Clearest angles; most common form faults |
| 2026-10-26 | Python desktop app | Assumed while the platform question is open; fastest to build |
| 2026-10-26 | Pin mediapipe 0.10.35 rather than 1.x | Known, stable Tasks API; revisit 1.x later |
| 2026-10-26 | Run PoseLandmarker in VIDEO mode, not LIVE_STREAM | Synchronous and deterministic, so webcam and replay share one code path |
| 2026-10-26 | Joint angles from world landmarks; alignment from image landmarks | World coordinates handle camera angle better; "vertical" only makes sense in the image |
| 2026-10-26 | Rules defined in YAML; live rules cue during the rep, aggregate rules when it ends | New exercises and threshold tuning need no code changes |

## Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-10-26 | First draft of the plan |
| 0.2 | 2026-10-26 | Core built: pipeline, squat/push-up/curl, cues, TTS, session log, replay, tests |
