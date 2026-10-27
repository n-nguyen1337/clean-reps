# cleanReps

Real-time exercise form feedback from a camera, using MediaPipe Pose. It counts reps, checks form against per-exercise rules, and gives on-screen and spoken cues.

The repo has two parts:

- **Web app** ([web/](web/)): the product. Runs in the browser on a laptop or phone; pose estimation stays on the device. See [PLAN-web.md](PLAN-web.md).
- **Python lab** ([cleanreps/](cleanreps/)): the original OpenCV prototype and the reference implementation, used to tune thresholds, replay clips and generate parity fixtures for the web engine. See [PLAN.md](PLAN.md).

A native mobile app is planned as an alternative in [PLAN-mobile.md](PLAN-mobile.md).

## Python lab

### Setup

```bash
python -m venv .venv
.venv/Scripts/activate        # Windows; use .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
```

The pose model (~9 MB) downloads to `models/` on first run.

### Usage

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

## Web app

Vite + React + TypeScript. Pose estimation runs on-device with MediaPipe `tasks-vision` (GPU delegate, CPU fallback). The engine is a TypeScript port of the Python one and reads the same YAML rules from [cleanreps/rules/](cleanreps/rules/), so thresholds are tuned in one place.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests + parity tests against the Python engine
npm run build      # type-check, then build a static site into web/dist
```

`dev` and `build` first run [web/scripts/fetch-assets.mjs](web/scripts/fetch-assets.mjs), which copies the MediaPipe wasm runtime into `public/mediapipe/` and the lite and full pose models into `public/models/` (from `../models/` if present, otherwise downloaded). Nothing is loaded from a CDN at runtime.

Phones default to the lite model and other devices to the full one; override with `?model=lite` or `?model=full`, or in the settings on the start screen.

| Path | What it is |
|---|---|
| [web/src/engine/](web/src/engine/) | TS port: geometry, One Euro filter, pose frame, exercises, rule engine, cues, session summary |
| [web/src/pose/landmarker.ts](web/src/pose/landmarker.ts) | MediaPipe setup and conversion to pixel-space landmarks |
| [web/src/ui/LiveSession.tsx](web/src/ui/LiveSession.tsx) | Camera loop, skeleton overlay, HUD, wake lock |
| [web/src/App.tsx](web/src/App.tsx) | Screens: exercise picker, live session, summary, progress |
| [web/src/store/](web/src/store/) | On-device history (IndexedDB via Dexie) and progress calculations |
| [web/src/cloud/](web/src/cloud/) | Optional Google sign-in, sync to Supabase |
| [supabase/](supabase/) | Database migration and Edge Functions (`coach`, `delete-account`) |

Camera access needs `localhost` or HTTPS, so to test on a phone, use the deployed app or a tunnel.

### Accounts, sync and AI coaching (Supabase)

Optional. Without the two `VITE_SUPABASE_*` variables the app runs local-only: history is still saved on the device, and sign-in and AI coaching are hidden. See [PLAN-progress.md](PLAN-progress.md) for the design.

One-time setup:

1. Create a Supabase project. Copy its URL and anon key into `web/.env.local` (template: [web/.env.example](web/.env.example)). Both are public; row-level security protects the data.
2. Google sign-in: create an OAuth client (Web application) in Google Cloud. Add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. Paste the client ID and secret into Supabase under Authentication > Sign In / Providers > Google.
3. In Supabase under Authentication > URL Configuration, set the Site URL to `https://clean-reps.trieuanh-nguyen1998.workers.dev`. Add `http://localhost:5173` and `https://*-clean-reps.trieuanh-nguyen1998.workers.dev/**` (preview versions) to the redirect URLs.
4. Apply the schema and deploy the functions with the [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # optional: COACH_DAILY_LIMIT=10 COACH_GLOBAL_DAILY_LIMIT=500 ALLOWED_ORIGINS=...
   npx supabase functions deploy coach
   npx supabase functions deploy delete-account
   ```

5. Keep the free project awake: in the GitHub repo, add Actions variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` for [.github/workflows/supabase-keepalive.yml](.github/workflows/supabase-keepalive.yml).

The AI coach calls Claude Haiku with your key from the `coach` function. Each signed-in user gets `COACH_DAILY_LIMIT` reviews per 24 hours, and `COACH_GLOBAL_DAILY_LIMIT` caps the total across all users. At about $0.001 per review, the defaults cap spend near $0.50 a day.

### Deploy

Live: https://clean-reps.trieuanh-nguyen1998.workers.dev, a Cloudflare Worker serving static assets, deployed by Workers Builds from GitHub. A push to `main` deploys production. Pushes to other branches upload preview versions at `https://<branch>-clean-reps.trieuanh-nguyen1998.workers.dev`. There are no manual deploy steps.

Worker settings (one-time, in the dashboard under the Worker > Settings > Build):

| Setting | Value |
|---|---|
| Git repository | `n-nguyen1337/clean-reps` |
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Build variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

[web/wrangler.jsonc](web/wrangler.jsonc) points the Worker at `dist/`. If the address changes (a custom domain, say), update `ALLOWED_ORIGINS` and the Supabase URLs.

The build reads the rules from `../cleanreps/rules` (Cloudflare clones the whole repo) and downloads the pose models. Node comes from [web/.node-version](web/.node-version), and caching and permission headers come from [web/public/_headers](web/public/_headers).

The old address, https://n-nguyen1337.github.io/clean-reps/app/, redirects here. The replay demo stays on GitHub Pages at the site root.

### Parity with the Python engine

The parity tests replay landmark fixtures exported by the Python pipeline and check that the TS engine reproduces every frame: metrics, phase, rep count, cues and completed reps. They're skipped when no fixtures exist. Generate fixtures from local clips with:

```bash
python tools/export_fixtures.py -e squat vids/clip.mp4   # writes web/fixtures/clip.squat.json
```

`web/fixtures/` is gitignored because the current fixtures come from stock clips. Any change to engine logic should land in Python first, then in TS, with the parity tests passing.

## How it works

```
VideoSource → PoseEstimator → PoseSmoother → Exercise.update → CueManager → overlay / speech
              (MediaPipe)     (One Euro)     (metrics, reps,   (priority,
                                              rules)            cooldown)
```

- **Metrics**: each exercise computes named metrics per frame ([cleanreps/exercises/](cleanreps/exercises/)). Joint angles use MediaPipe's 3D world landmarks; alignment checks use image coordinates.
- **Reps**: one primary metric drives a `top → descending → bottom → ascending` state machine with hysteresis. Movements that never reach the bottom are reported as partial reps.
- **Rules**: thresholds live in YAML ([cleanreps/rules/](cleanreps/rules/)). Live rules cue during the rep; rules with `aggregate: min|max` are checked when the rep ends.

The web app runs the same pipeline in the browser: `PoseLandmarker` (tasks-vision) → `PoseSmoother` → `Exercise.update` → `CueManager` → canvas overlay / Web Speech.

## Tests

```bash
pytest                 # Python lab
cd web && npm test     # web engine
```

Python unit tests use synthetic metric streams. For end-to-end regression tests, record clips into `tests/clips/` with a JSON label next to each (see [tests/test_replay_clips.py](tests/test_replay_clips.py)). The web tests port the engine unit tests and add the parity tests described above.

## TODO

### To verify
- [ ] **Phones**: the web app has only been run in desktop Edge, at ~26 fps with the full model on a 25 fps fake camera. Measure fps, heat and battery on a recent iPhone (Safari) and a mid-range Android (Chrome), with both models. This is the W1 go/no-go in [PLAN-web.md](PLAN-web.md).
- [ ] **iOS Safari quirks**: speech unlock on the Start tap, camera permission prompts, wake lock.
- [ ] **Thresholds on real home footage**: the rules were only checked on two stock clips. Record labeled clips from a laptop on a table and a phone propped on the floor ([PLAN.md](PLAN.md) M1–M3).

### Not built yet
- [ ] Setup flow: placement guidance, full-body-in-frame and camera-angle check, hands-free countdown
- [ ] Stay silent when landmark confidence is low, instead of cueing on bad data
- [ ] Session history (IndexedDB) with JSON export
- [ ] PWA: manifest, service worker, offline model caching, install prompt
- [ ] "That cue was wrong" button, stored locally and exportable
- [ ] Lunge and plank (plank needs a timed "hold" mode in the engine, in Python first)
- [ ] Camera switch (front/back) on phones

### To decide
- [ ] **Curl**: it's still in the picker, but the plan drops it for v1 since most home users have no dumbbells. Keep or hide it?
- [ ] **Fixtures in git**: commit parity fixtures once there are self-recorded clips, so CI can run the parity tests?
- [ ] **Dependency versions**: `npm` installed the current majors (React 19, Vite 8, TypeScript 7, tasks-vision 1.1), while the Python side pins mediapipe 0.10.35. Pin exact versions, and decide whether to move Python to mediapipe 1.x.
- [ ] **Analytics**: none, or privacy-friendly page counts (e.g. GoatCounter) for the beta?
- [ ] **Uncommitted `pyproject.toml` change** (`opencv-python` → `opencv-contrib-python>=5.0`): keep or revert.

Not medical advice. Thresholds are starting points; tune them for your body and camera.
