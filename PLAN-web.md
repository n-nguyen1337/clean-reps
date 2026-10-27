# cleanReps Web — Product Plan

| | |
|---|---|
| **Status** | In progress: engine ported with parity tests; first live session working on desktop |
| **Plan version** | 0.2 |
| **Last updated** | 2026-10-26 |

## Concept

A free web app for people working out at home. Open a link on a laptop or phone, prop the device up, and get rep counting and spoken form cues. Pose estimation runs in the browser, so video never leaves the device. There are no accounts and no backend.

The Python package in this repo stays as the **lab**: threshold tuning, labeled clips and regression tests. The web app is the client users actually run.

## Why web

- **No install.** A link is all a user needs, which suits a free side project with no marketing budget.
- **No store review or fees.** Ship by pushing to `main`; Cloudflare Pages builds and deploys it.
- **Laptop and phone.** Many home workouts happen in front of a laptop, which a mobile-only app can't serve.
- **The TS engine carries over to mobile.** If a native app comes later, the same TypeScript engine can run in React Native.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Vite + TypeScript + React | Static build; no server code |
| Pose | `@mediapipe/tasks-vision` `PoseLandmarker`, VIDEO mode, GPU delegate | Same model and 33 landmarks as the prototype. Drive it from `requestVideoFrameCallback`. |
| Model | Self-hosted `.task` files (lite ~5 MB, full ~9 MB) | Lite by default on phones, full on laptops; cached by the service worker |
| Engine | TS port of `geometry`, `filters`, `exercises/base`, `feedback` | Rules compiled from YAML to JSON at build time |
| Voice | Web Speech API (`speechSynthesis`) | iOS Safari needs a user gesture first: speak on the "Start" tap |
| Screen | Screen Wake Lock API | Keeps the screen on mid-set; supported in Safari 16.4+ |
| Storage | IndexedDB (Dexie) | Set history; `navigator.storage.persist()`; JSON export. Optional sync to Supabase ([PLAN-progress.md](PLAN-progress.md)) |
| Offline / install | PWA manifest + service worker | Add to home screen; runs offline after the first visit |
| Hosting | Cloudflare Pages, Git integration (HTTPS, which camera access requires) | Preview URL per branch; the replay demo stays on GitHub Pages |

## Repo layout

```
clean-reps/
  cleanreps/              # Python lab (existing)
  rules/                  # single source of truth (YAML), compiled to JSON for the app
  tools/export_fixtures.py
  web/
    src/engine/           # TS port
    src/engine/__tests__/ # parity tests against Python fixtures (Vitest)
    src/ui/
    public/models/
```

## Milestones

### W0 — Validate the engine (1–2 weeks, shared with the mobile plan)
- [ ] Record about 10 labeled clips from **home-style placements**: a laptop on a table, and a phone propped on the floor or a chair
- [ ] Confirm squat and push-up rep counting and tune thresholds (open items in [PLAN.md](PLAN.md))
- [ ] Camera-angle and full-body-in-frame check

### W1 — Browser spike (1 week)
- [x] Camera, PoseLandmarker and a skeleton overlay (desktop Edge: ~26 fps with the full model on a 25 fps feed)
- [ ] Measure fps and latency on a laptop, a recent iPhone (Safari) and a mid-range Android (Chrome), with both lite and full models
- [ ] Check a 10-minute session for heat and throttling on the phones
- [ ] **Go/no-go:** at least 20 fps with the lite model on a mid-range phone; otherwise make the app laptop-first and treat phones as best effort

### W2 — Engine port with parity tests (1–2 weeks)
- [x] `tools/export_fixtures.py`: dump landmark streams plus expected metrics, reps and faults from the labeled clips as JSON
- [x] Port the engine to TS; Vitest replays the fixtures and must match the Python output
- [x] Share rules with the app (it imports `cleanreps/rules/*.yaml` directly; no move needed)

### W3 — MVP (3–4 weeks)
- [ ] Exercise picker: squat, push-up, lunge, plank (curls removed; most home users have no dumbbells)
- [ ] "Hold" mode in the engine for plank (timer plus form checks)
- [ ] Setup flow: placement guidance, full body in frame, right angle, then a hands-free countdown once in position
- [x] Live session: skeleton, rep counter, spoken cues
- [ ] Stay silent when confidence is low
- [x] Summary (reps, clean vs faulted, top faults)
- [x] Local history list and progress charts
- [ ] "That cue was wrong" button, stored locally and exportable
- [ ] Disclaimer on first visit; PWA install prompt

### W4 — Open beta (3–4 weeks)
- [ ] Share the link with 15–30 people; collect feedback through a simple form
- [ ] Optional privacy-friendly page analytics (e.g. GoatCounter), with no session data sent
- [ ] Track sessions per user per week, setup abandonment and wrong-cue reports
- [ ] Tune in the Python lab, then ship updated rule JSON

### W5 — Launch
- [ ] Landing page with a demo clip, replacing the current demo site
- [ ] Post to r/bodyweightfitness, r/homegym and Show HN

### Later
- [ ] Wrap with Capacitor for store listings, or reuse the engine in React Native ([PLAN-mobile.md](PLAN-mobile.md))
- [ ] Run pose in a Web Worker with OffscreenCanvas if the main thread stutters
- [ ] Progression tracking with optional Google sign-in and sync ([PLAN-progress.md](PLAN-progress.md))

## Risks

| Risk | Mitigation |
|---|---|
| Phone browsers are slower than native | Lite model on phones; measured in W1; laptop-first fallback |
| iOS Safari quirks (audio unlock, camera permission prompts, PWA limits) | Speak on the first tap; test on a real iPhone every milestone |
| Safari may clear storage for sites not used for 7 days | Prompt to install to the home screen; `storage.persist()`; JSON export |
| Switching tabs or locking the screen stops the camera | Wake Lock; pause the session cleanly and resume |
| Wrong cues erode trust | Cue only when confident; wrong-cue button; conservative thresholds |
| Low camera angles distort joint angles | W0 clips use home placements; setup flow enforces position |

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-26 | Target home workout users; free, no accounts | Side project; simplest audience and setup |
| 2026-10-26 | Pose runs on-device in the browser; no backend | Privacy, zero running cost |
| 2026-10-26 | Python package is the reference implementation | Tune once; parity tests keep the TS port honest |
| 2026-10-27 | Optional AI coaching with the user's own Anthropic API key, called from the browser | Keeps no backend and zero running cost; only per-rep numbers are sent, never video. Charts and insights stay local and free |
| 2026-10-27 | Progression tracking: local-first history, optional Google sign-in syncing to Supabase | Keeps the no-account start; sync and backup for those who want it. Static hosting stays; RLS replaces server code |
| 2026-10-27 | AI coach moves to a Supabase Edge Function with the app's key, rate-limited per signed-in user | Supersedes bring-your-own-key: most users don't have an API key. Daily per-user and global caps bound the cost |
| 2026-10-27 | Host the app on Cloudflare Pages (Git integration) instead of GitHub Pages | Free with unlimited bandwidth, deploys on push with preview URLs per branch, custom headers; replaces the manual gh-pages steps. The old /app/ URL redirects |

## Changelog

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-10-26 | First draft |
| 0.2 | 2026-10-26 | Web app scaffolded in `web/`: TS engine, parity tests, live session, summary |
