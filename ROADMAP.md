# cleanReps — Roadmap

| | |
|---|---|
| **Status** | Web app live at https://clean-reps.pages.dev; no real users yet |
| **Last updated** | 2026-10-27 |

This file is the overview: what exists today, and what each stage of growth needs, from the first 100 users to 100,000+. The detailed plans stay in the `PLAN-*.md` files and are linked from here.

The architecture is a good base for scale. Pose estimation runs in the browser, so the heavy work costs nothing per user. The only server-side costs are set sync (a few KB per set), sign-in, and the AI coach. Most of the scaling work is therefore product, trust and operations work, not infrastructure.

---

## 1. What's done

### Engine
- Python reference implementation (OpenCV + MediaPipe Pose): geometry helpers, One Euro smoothing, rep state machine with hysteresis and partial-rep detection, YAML rules, cue manager with priority and cooldown ([PLAN.md](PLAN.md))
- Two exercises: **squat** (depth, torso lean adjusted for body build, knee cave, knees-only squats not counted) and **push-up** (depth, hip sag, hip pike, lockout). Bicep curl removed.
- TypeScript port of the engine that reads the same YAML rules, with **parity tests** that replay Python-exported landmark fixtures frame by frame
- Clip replay, headless mode, regression harness for labeled clips, unit tests on both sides

### Web app ([PLAN-web.md](PLAN-web.md))
- Vite + React + TS, on-device MediaPipe `tasks-vision` (GPU with CPU fallback), lite model on phones and full on desktop, no CDN at runtime
- Live session: skeleton overlay, rep counter, on-screen and spoken cues, chime on clean reps, wake lock
- Set summary with charts, insights and a "since last time" line
- **Set playback** ([PLAN-playback.md](PLAN-playback.md)): the recorded video with the pose skeleton overlaid, rep timeline, seek from any rep, loop, frame step, speed. Kept in memory only.
- **Progress** ([PLAN-progress.md](PLAN-progress.md)): local-first history in IndexedDB, trend charts (volume, form score, depth, fault trend, tempo), PRs and streaks, delete, JSON export
- **Achievements and levels** ([PLAN-achievements.md](PLAN-achievements.md)): 59 achievements, XP and one overall level, derived from set history
- **App shell** ([PLAN-landing.md](PLAN-landing.md)): Home, Progress, About and Settings behind a tab bar with hash routes; cleanReps logo

### Backend (optional, Supabase)
- Google sign-in; sync with a cursor, idempotent uploads and soft deletes; row-level security
- `coach` Edge Function calling Claude Haiku with per-user (10/day) and global (500/day) caps; billed reviews aren't refunded on refusal
- `delete-account` Edge Function, privacy copy, keep-alive GitHub Action
- Hosting on Cloudflare Pages with preview deploys per branch

### Not done yet (carried into Phase 0 and 1)
- **Never tested on a real phone** or on real home footage; thresholds tuned on two stock clips only
- `ANTHROPIC_API_KEY` not set, so the coach is off; Google sign-in configured but not yet tried end to end. (The Supabase project is live and RLS passes its tests there.)
- No setup flow (framing, camera angle, countdown), no low-confidence silence, no wrong-cue button
- No PWA (manifest, service worker, offline), no first-visit disclaimer, no analytics, no error reporting
- Only two exercises; no plank (needs a hold mode) or lunge

---

## 2. Phases by user count

Each phase lists the goal, what to build, what to scale, the expected cost, and the signal to move on. "Users" means weekly active users (people who finish at least one set in a week), not sign-ups.

### Phase 0 — Validate (just you and a few friends)

**Goal:** prove the core claim, "it counts my reps correctly and its cues are right", on real phones in real homes.

Product
- Record ~10 labeled clips from home placements (laptop on a table, phone on the floor or a chair) with deliberate faults; tune thresholds in the Python lab
- Run the W1 go/no-go: fps, heat and battery on a recent iPhone (Safari) and a mid-range Android (Chrome), lite and full models, 10-minute sessions
- Fix iOS Safari quirks: speech unlock on the Start tap, camera prompts, wake lock
- **Setup flow**: full body in frame, camera-angle check, hands-free countdown. This is the biggest single fix for wrong cues.
- **Stay silent when landmark confidence is low**

Infrastructure
- ~~Create the Supabase project; run the two-user RLS test~~ done 2026-10-27 (`node supabase/tests/run-linked.mjs`)
- ~~Create the Google OAuth client, turn off the Email provider~~ done 2026-10-27
- Set `ANTHROPIC_API_KEY`; try sign-in and sync end to end
- Commit parity fixtures from self-recorded clips so CI can run the parity tests
- Pin dependency versions

**Cost:** $0. **Move on when:** rep counts match a human count on ≥ 95% of clean clips, the app holds ≥ 20 fps with the lite model on a mid-range phone, and you'd trust the cues yourself.

### Phase 1 — 0 to 100 users (closed beta)

**Goal:** learn whether people come back. Talk to every user.

Product
- **"That cue was wrong" button**, stored locally and sent with consent; it's the main source of tuning data
- First-visit disclaimer and a camera permission explainer
- **PWA**: manifest, service worker, offline model caching, install prompt (also protects history from Safari's 7-day storage eviction)
- Front/back camera switch on phones
- **Plank** (hold mode in the engine, Python first) and **lunge**: four exercises cover a basic bodyweight routine
- A feedback form linked from Settings

Measurement
- Privacy-friendly page analytics (GoatCounter or Plausible), no session data
- A few product events: set started, set finished, setup abandoned, wrong-cue report, coach used. Store them in a small Supabase table or use PostHog's free tier.
- Error reporting with Sentry's free tier, with video and landmarks stripped

Operations
- Recruit 15–30 testers from friends, gyms and r/bodyweightfitness; a group chat for feedback
- Weekly tuning loop: wrong-cue reports → clips → Python lab → parity tests → ship the updated rules

**Cost:** ~$0–5/month (free tiers; coach spend under $0.50/day). **Move on when:** ≥ 30% of testers still train with it in week 4, and wrong-cue reports are trending down.

### Phase 2 — 100 to 1,000 users (public launch)

**Goal:** a public launch that a stranger can use without help.

Product
- **Workouts, not just sets**: a short routine (e.g. 3 × squats, push-ups, plank) with rest timers and spoken transitions
- Onboarding: pick a goal and level, get a suggested first routine
- Reminders: web push for installed PWAs, or a weekly email for signed-in users
- Shareable set card (image of reps, clean %, badges) for organic growth
- Sync achievements to the account, so unlocks from deleted sets aren't lost across devices
- Landing page with a demo clip, replacing the GitHub Pages demo; custom domain
- Apple sign-in if iPhone users ask; email magic link as a fallback

Scale and reliability
- **Supabase Pro ($25/month)**: removes the 7-day pause, adds daily backups. Drop the keep-alive Action.
- Move the pose loop to a **Web Worker with OffscreenCanvas** if the main thread stutters on mid-range phones
- Coach: raise the global cap gradually and alert at 80% of it; cache identical requests
- Uptime check on the app and the Edge Functions; a status line in the app when sync is down
- Versioned rules shipped as JSON so tuning doesn't need a full app deploy

Launch
- Post to r/bodyweightfitness, r/homegym and Show HN; a short demo video for TikTok and Reels
- Privacy policy and terms pages (needed for sign-in and for the stores later)

**Cost:** ~$30–50/month (Supabase Pro, domain, coach up to ~$1/day). **Move on when:** week-4 retention holds at launch-level traffic, and a channel brings users without you posting by hand.

### Phase 3 — 1,000 to 10,000 users (growth)

**Goal:** a repeatable growth loop and a path to covering costs.

Product
- **Native apps**: wrap the web app with Capacitor for store listings, or move to React Native if the W1 numbers on phones were weak ([PLAN-mobile.md](PLAN-mobile.md)). Store presence matters for discovery and trust at this size.
- Apple Health / Health Connect export
- More exercises, chosen from requests: glute bridge, hip hinge, burpee, wall sit, side plank
- Programs: multi-week progressions that adapt to the user's clean % and depth trends
- AI coach upgrades: weekly review across sets, not just one set; follow-up questions
- Localization of cues and UI for the top two non-English markets
- Accessibility pass: screen reader labels, captions for spoken cues, color contrast

Monetization (introduce here, not earlier)
- **Freemium**: core counting and cues stay free and on-device. A paid tier (~$3–5/month) adds the AI coach without tight limits, programs, unlimited history and saved playback.
- Payments through Stripe on the web, store billing in the native apps
- Paywalled features are those with a real per-user cost (AI, storage), so free users stay cheap

Scale and reliability
- Server-side weekly aggregates (Postgres views or a nightly job) if client-side progress gets slow for heavy users
- Paginate history and sync; archive or compact old set rows
- Per-user rate limits on every Edge Function, not only the coach
- Staging Supabase project; migrations run in CI against it before production
- Feature flags (PostHog or a simple table) for staged rollouts of new rules
- On-call basics: alerts to your phone for error spikes, coach spend and sync failures

Data and quality
- An opt-in **labeled clip program**: users donate a clip with consent, which grows the regression suite. Requires clear consent, storage limits and a deletion path.
- A rules regression dashboard: per-exercise false-cue rate from wrong-cue reports, before and after each rules release

**Cost:** ~$100–500/month (Supabase, Sentry, analytics, coach, store fees), offset by subscriptions. **Move on when:** revenue covers running costs, and growth no longer depends on you.

### Phase 4 — 10,000 to 100,000 users (scale)

**Goal:** turn a side project into a product people pay for and depend on.

Product
- Per-exercise skill levels and personalized thresholds (learned from each user's own clean reps)
- Social features that fit the privacy stance: friends, challenges, leaderboards on clean reps, all opt-in
- Wearable cues (watch haptics) and casting to a TV
- Equipment exercises (dumbbell, kettlebell) if the audience asks; this reverses the "no equipment" decision, so check demand first
- Coach plans for personal trainers: they assign routines and see clients' form trends

Scale and reliability
- Supabase Team plan or a larger compute add-on; read replicas for analytics queries
- Move analytics off the production database (event pipeline into a warehouse such as BigQuery or ClickHouse)
- A model-serving decision for the AI coach: batching, a cheaper model for routine reviews, the larger model for weekly reviews
- Evaluate a custom or fine-tuned pose model for exercise-specific accuracy, still running on-device
- Formal incident process, runbooks, SLOs for sync and sign-in

Company
- GDPR and CCPA compliance review (data export and deletion already exist), DPA with vendors
- Health claims review before any marketing beyond "form feedback"
- Hire or contract: a second engineer, a part-time support person, a fitness professional to review rules and programs

**Cost:** low thousands per month, dominated by AI, analytics and staff; still no per-user GPU cost thanks to on-device pose.

### Phase 5 — 100,000+ users

**Goal:** platform and partnerships.

- B2B: licensing the engine to gyms, physio clinics and corporate wellness programs (needs an SDK and stronger accuracy validation)
- Physio and rehab mode: this moves toward medical claims and possibly medical device regulation, so treat it as a separate product decision with legal advice
- Public API or SDK for other fitness apps
- Multi-region data residency if enterprise customers require it
- Research partnership to validate accuracy against motion capture and publish the results

---

## 3. Scaling summary

| Area | 0–100 | 100–1k | 1k–10k | 10k–100k | 100k+ |
|---|---|---|---|---|---|
| Pose compute | On-device | On-device | On-device | On-device (custom model?) | On-device + SDK |
| Hosting | CF Pages free | CF Pages free + domain | CF Pages + native apps | CF Pages + native apps | Same |
| Database | Supabase free | Supabase Pro | Pro + staging, aggregates | Team plan, replicas, warehouse | Multi-region |
| AI coach | 500/day global cap | Raised cap, alerts | Paid tier, weekly reviews | Model routing, batching | Partner plans |
| Observability | Sentry free, page counts | Uptime checks, events | Flags, on-call alerts | Warehouse, SLOs | Incident process |
| Monthly cost | ~$0 | ~$30–50 | ~$100–500 | Low thousands | Revenue-funded |

## 4. Risks that grow with users

| Risk | When it bites | Mitigation |
|---|---|---|
| Wrong cues erode trust | From the first user | Setup flow, low-confidence silence, wrong-cue button, conservative thresholds |
| Phone performance and heat | Phase 1 | W1 measurements, lite model, Web Worker, native apps if needed |
| Safari clears local history | Phase 1 | PWA install, `storage.persist()`, sign-in backup |
| AI coach costs or abuse | Phase 2 | Sign-in required, per-user and global caps, paid tier |
| Injury claims or health regulation | Phase 3+ | Fitness-only wording, disclaimer, professional rule review, legal review before rehab features |
| Privacy expectations | Always | Video never leaves the device; clip donation is opt-in only; deletion and export already built |
| Single maintainer | Phase 3 | Docs, CI with parity tests, runbooks, then a second engineer |
