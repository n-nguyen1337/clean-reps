# cleanReps Mobile — Product Plan

| | |
|---|---|
| **Status** | Proposal; competing with [PLAN-web.md](PLAN-web.md) |
| **Plan version** | 0.1 |
| **Last updated** | 2026-10-26 |

## Concept

A free iOS and Android app for people working out at home. Prop the phone up, and it counts reps and speaks form cues. Pose estimation runs on the device, so video never leaves the phone. There are no accounts and no backend.

The Python package in this repo stays as the **lab**: threshold tuning, labeled clips and regression tests. The app is the client users actually run.

## Why native

- **Performance.** Native camera pipelines and GPU access run pose faster and cooler than a phone browser.
- **Feels like an app.** Home-screen icon, reliable background audio, no browser tabs, and storage that doesn't get evicted.
- **Discoverability.** Store listings bring some organic users.
- **Cost:** store fees, review, and a slower release cycle.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| App | React Native (Expo dev build) + TypeScript | One codebase; EAS cloud builds ship iOS from Windows without a Mac |
| Camera | `react-native-vision-camera` | Frame processors run on a worklet thread |
| Pose | MediaPipe PoseLandmarker through a VisionCamera frame-processor plugin | Same model and 33 landmarks as the prototype. Plugin maturity is the main unknown (M1). |
| Engine | TS port of `geometry`, `filters`, `exercises/base`, `feedback` | Rules compiled from YAML to JSON at build time |
| Voice | `expo-speech` (native TTS) | Main feedback channel; the user is 2–3 m from the phone |
| Screen | `expo-keep-awake` | Keeps the screen on mid-set |
| Storage | `expo-sqlite` | Session history; JSON export |
| Crash reports | Sentry (free tier) | Crash reports only; no session data |

**Fallback:** if the plugin can't hold 25 fps on a mid-range Android, build Android-only in Kotlin with the official MediaPipe Tasks SDK. The engine logic ports to Kotlin the same way, and iOS waits.

## Repo layout

```
clean-reps/
  cleanreps/              # Python lab (existing)
  rules/                  # single source of truth (YAML), compiled to JSON for the app
  tools/export_fixtures.py
  app/
    src/engine/           # TS port
    src/engine/__tests__/ # parity tests against Python fixtures (Jest)
    src/screens/
    assets/models/
```

## Milestones

### M0 — Validate the engine (1–2 weeks, shared with the web plan)
- [ ] Record about 10 labeled clips with a **phone propped on the floor or a chair**, the way home users will film
- [ ] Confirm squat and push-up rep counting and tune thresholds (open items in [PLAN.md](PLAN.md))
- [ ] Camera-angle and full-body-in-frame check

### M1 — Native spike (1–2 weeks)
- [ ] Expo dev build, VisionCamera, pose plugin and a skeleton overlay
- [ ] Measure fps, latency, battery drain and heat over a 10-minute session on a cheap Android and an iPhone
- [ ] **Go/no-go:** at least 25 fps with the full model, or 20 fps with lite, on a mid-range Android; otherwise switch to the Kotlin fallback

### M2 — Engine port with parity tests (1–2 weeks)
- [ ] `tools/export_fixtures.py`: dump landmark streams plus expected metrics, reps and faults from the labeled clips as JSON
- [ ] Port the engine to TS; Jest replays the fixtures and must match the Python output
- [ ] Move rules to `rules/`, compiled to JSON for the app

### M3 — MVP (3–4 weeks)
- [ ] Exercise picker: squat, push-up, lunge, plank (drop curls; most home users have no dumbbells)
- [ ] "Hold" mode in the engine for plank (timer plus form checks)
- [ ] Setup flow: placement guidance, full body in frame, right angle, then a hands-free countdown once in position
- [ ] Live session: skeleton, rep counter, spoken cues; stay silent when confidence is low
- [ ] Summary (reps, clean vs faulted, top faults) and a local history list
- [ ] "That cue was wrong" button, stored locally and exportable
- [ ] Disclaimer on first launch; camera permission explainer screen

### M4 — Closed beta (3–4 weeks)
- [ ] **Android:** Play Console account ($25). New personal accounts must run a closed test with at least 12 testers for 14 days before publishing to production, so recruit testers during M3.
- [ ] **iOS:** Apple Developer Program ($99/year); TestFlight
- [ ] Track sessions per user per week, setup abandonment and wrong-cue reports
- [ ] Tune in the Python lab, then ship updated rule JSON through EAS Update (over the air, no store review)

### M5 — Store release
- [ ] Store listings, screenshots, a demo video
- [ ] Privacy labels: "no data collected" holds if nothing leaves the phone (apart from Sentry crash reports, which must be declared)
- [ ] Listing copy that makes fitness claims only, not medical ones

### Later
- [ ] Apple Health / Health Connect export
- [ ] Watch app for cues on the wrist
- [ ] Optional sync across devices (would need accounts and a backend)

## Risks

| Risk | Mitigation |
|---|---|
| RN pose plugin is immature or unmaintained | M1 spike first; Kotlin fallback defined |
| Phone heats up and throttles | Measure in M1; lite model; lower frame rate between reps |
| Store review delays or rejections (health claims) | Fitness-only wording; disclaimer; read the guidelines before M5 |
| Play closed-test requirement delays launch | Recruit 12+ testers during M3 |
| Wrong cues erode trust | Cue only when confident; wrong-cue button; conservative thresholds |
| Low camera angles distort joint angles | M0 clips use phone placements; setup flow enforces position |
| Other people or pets in frame | Track the largest or centered person; pause if tracking switches |

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-26 | Target home workout users; free, no accounts | Side project; simplest audience and setup |
| 2026-10-26 | Pose runs on-device; no backend | Privacy, zero running cost |
| 2026-10-26 | React Native + Expo, pending the M1 spike | One codebase for both stores; builds iOS from Windows |
| 2026-10-26 | Python package is the reference implementation | Tune once; parity tests keep the TS port honest |

## Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-10-26 | First draft |
