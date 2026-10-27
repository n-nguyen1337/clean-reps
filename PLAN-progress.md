# cleanReps Progression Tracking — Plan

| | |
|---|---|
| **Status** | P1–P5 implemented; Supabase project not yet created |
| **Plan version** | 0.2 |
| **Last updated** | 2026-10-27 |

## Concept

Every finished set is saved, so users can see how their reps, depth, form and tempo change over weeks. History lives **on the device first**: anyone can use it without an account. Signing in with Google backs it up to Supabase and syncs it across devices (for example, a laptop for squats and a phone for push-ups).

Video and landmarks never leave the device. Only the set's numbers do, and only after sign-in.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Backend | Supabase (Postgres, Auth, row-level security) | The static app talks to it directly, so there's no server code to host. SQL suits trend queries. The free tier covers a side project. |
| Accounts | Local-first; sign in only to sync | Keeps the zero-friction start. Progress tracking still works offline and signed out. |
| Sign-in | Google OAuth only | One tap on Android and desktop, and no passwords or email deliverability to manage. Apple can come later if iPhone users ask. |
| Stored per set | Summary, each rep's result, and the exercise config used; no 10 Hz trace | A past set reopens in the Summary screen exactly as it was, at a few KB per set. The trace is about 10× bigger and only used for the live summary. |
| AI coach | `coach` Edge Function with the app's Anthropic key, rate-limited per signed-in user | Removes the bring-your-own-key step. A daily cap per user plus a global cap bound the spend. |

## Architecture

```
 Browser (Cloudflare Worker, static assets)     Supabase
┌──────────────────────────────┐            ┌──────────────────────────┐
│ Session → SetRecord           │            │ Auth (Google OAuth, PKCE) │
│        │                      │            │                          │
│        ▼                      │  upsert    │ Postgres                 │
│ IndexedDB (Dexie): sets  ─────┼──────────► │   sets      (RLS: own)   │
│        ▲            sync.ts   │ ◄──────────┼── profiles  (RLS: own)   │
│        │                      │  pull since│                          │
│ History + Progress screens    │  cursor    │                          │
└──────────────────────────────┘            └──────────────────────────┘
```

- The app always reads from IndexedDB. Sync runs in the background and never blocks the UI.
- `supabase-js` (about 50 KB gzipped) loads lazily, only when the user signs in or is already signed in. This is the same pattern as the AI coach chunk.
- The Supabase anon key ships in the bundle. That's expected: it's public by design, and row-level security is what protects the data.

## Data model

### Client: `SetRecord` (IndexedDB, and the sync payload)

Built by `toSetRecord()` ([web/src/store/record.ts](web/src/store/record.ts)) when a set ends:

| Field | Notes |
|---|---|
| `id` | `crypto.randomUUID()`, created on the device; makes uploads idempotent |
| `v` | Schema version of the record |
| `summary` | The existing `SessionSummary` (exercise, start time, reps, clean, partial, faults, tempo) |
| `durationS` | From the trace, which is otherwise dropped |
| `reps` | `RepResult[]` with timings and extremes rounded to 2 decimals; `analyze()` rebuilds every chart and insight from these |
| `config` | The exercise config with limits already adjusted for `body`. Thresholds will be retuned, and old sets must still read correctly. |
| `body`, `appVersion` | |
| `updatedAt`, `deletedAt`, `syncedAt` | Sync bookkeeping. Deletes are soft so they can sync. |

### Server: Postgres (`supabase/migrations/`)

See [supabase/migrations/20261027000000_progress.sql](supabase/migrations/20261027000000_progress.sql). In short:

- `sets`: one row per set, keyed by the device-generated `id`, with `user_id default auth.uid()`. Summary fields are columns, and `config` and `rep_results` are `jsonb`. A trigger sets `updated_at` from the server clock. RLS lets users select, insert and update only their own rows, and there's no delete policy (deletes are soft).
- `coach_requests` and `claim_coach_request()`: the AI coach's rate limit. RLS is on with no policies, and only the service role can call the function. It takes a per-user advisory lock, so parallel requests can't both take the last slot.
- Everything cascades from `auth.users`, so deleting the account deletes the data.

The summary fields get real columns so server-side queries can use them later. The per-rep data stays in `jsonb` because it's always read whole. There's no `profiles` table yet: body proportions stay in local storage and are saved with each set.

**Size:** a 20-rep set is about 3 KB, so the 500 MB free tier holds around 150k sets.

## Sync

The rules stay simple because a set is never edited after it's saved. The only change is a delete.

1. **Push:** upsert every local set where `syncedAt` is null or `updatedAt > syncedAt`, in batches of 50, then mark them synced. Upserting by `id` means a retry can't create duplicates.
2. **Pull:** select sets where `updated_at` is later than the last pull cursor, put them into IndexedDB, and advance the cursor. A server-side `updated_at` trigger keeps the cursor safe from device clock drift.
3. **When it runs:** on sign-in, when the app starts while signed in, after each set, and when the device comes back online. A failure is retried on the next trigger, not in a loop.
4. **First sign-in:** sets recorded before signing in are uploaded to the account. If a second account later signs in on the same device, ask before merging that device's local history.
5. **Sign-out:** keep or clear local history, chosen by the user (clear is the default on shared devices).

The only conflict is a delete racing an upload, and the later `updatedAt` wins.

## Progress features (client-side, from IndexedDB)

| View | Metric |
|---|---|
| History list | Sets grouped by day, each with reps, clean % and top fault. Tapping one opens the existing Summary from the stored `repData`. |
| Volume | Reps per week, per exercise |
| Form score | Clean reps ÷ counted reps per set, with a 4-set rolling average |
| Depth / range | Median `bottom` of the primary metric per set (for example, squat knee angle) |
| Fault trend | How often each fault happens per set, over time |
| Tempo | Average down and up seconds |
| Streaks / PRs | Most clean reps in a set, consecutive training weeks |

Charts reuse `charts.tsx` and the existing palette. Trends compare a set against its own stored `limits`, so retuned thresholds don't rewrite old results.

## AI coach

The browser builds the same numbers-only input as before (`coachInput()`) and calls the `coach` Edge Function with the user's session. The function:

1. Checks the caller's JWT. Signed-out callers get a 401.
2. Validates the input against a strict schema with tight length caps, so the endpoint can't be used as a general-purpose proxy to Claude.
3. Claims a request from `claim_coach_request()`: `COACH_DAILY_LIMIT` per user per 24 hours (default 10), and `COACH_GLOBAL_DAILY_LIMIT` across everyone (default 500, about $0.50 a day).
4. Calls Claude Haiku 5.5 with structured output. If the call fails, or the model refuses or returns unreadable output, it refunds the claim.

## Privacy and account

- About text says "No account needed" and explains optional sign-in
- A privacy note that lists exactly what's stored, and that video and landmarks never are
- Export all history as JSON. This works signed in or out.
- Delete account: a Supabase Edge Function (service role) deletes the auth user, and the data goes with it through `on delete cascade`. App stores need this too if the app is wrapped later.

## Milestones

### P1 — Local history (about 1 week, no backend)
- [x] Dexie DB with a `sets` table, `storage.persist()` on the first save
- [x] Build a `SetRecord` from `SessionRecord` and `analyze()`, and save it when a set ends
- [x] Progress screen with history; open a past set in Summary (the trace chart is skipped for past sets)
- [x] Delete a set; JSON export
- [x] Unit tests: the `SetRecord` builder and a round trip through fake-indexeddb

### P2 — Supabase project and auth (about 1 week)
- [x] `supabase/` folder with the migration and config (row types are hand-written in `cloud/remote.ts`)
- [ ] Create the Supabase project (see README)
- [ ] Google OAuth (manual, see README): Google Cloud client; redirect allow-list for `https://clean-reps.trieuanh-nguyen1998.workers.dev`, its preview versions and `localhost:5173`
- [x] Sign-in and sign-out in Settings; lazy-loaded `supabase-js`
- [ ] RLS test against the live project: user A can't read, write or overwrite user B's rows (two test users)

### P3 — Sync (about 1 week)
- [x] `sync.ts` push and pull with a cursor; triggers; offline handling
- [x] Upload local sets on first sign-in. Sign-out removes synced sets from the device and keeps unsynced ones (no prompt).
- [x] Tests against a fake client: idempotent retry, delete propagation, cursor advance

### P4 — Progress screens (1–2 weeks)
- [x] Trend charts from the table above, per exercise
- [x] PRs and streaks; a "since last time" line on the Summary screen

### P5 — Privacy and launch
- [x] Privacy copy, account deletion Edge Function, export
- [x] Update PLAN-web.md and the README (Supabase setup, env vars at build time)
- [x] `coach` Edge Function with per-user and global daily limits; bring-your-own-key removed
- [x] Weekly keep-alive GitHub Action

## Risks

| Risk | Mitigation |
|---|---|
| Supabase pauses free projects after 7 days without activity | Local-first means the app keeps working and sync resumes after unpausing. A weekly GitHub Actions cron pings the API. |
| OAuth redirects on preview deployments | PKCE flow; wildcard redirect URL for `*-clean-reps.trieuanh-nguyen1998.workers.dev` |
| Safari clears IndexedDB for sites unused for 7 days | Signing in makes the server the backup; `storage.persist()`; install prompt |
| Thresholds retuned after sets were saved | Each set stores the exercise config it ran with |
| Schema changes after launch | Each set carries a schema `v`; migrations live in the repo |
| Someone scripts the coach endpoint | Sign-in required, strict input schema, per-user and global daily caps |
| The anon key is visible in the bundle | Expected; RLS is the protection and gets tested in P2 |

## Later

- Apple sign-in if iPhone users ask for it
- Server-side weekly summaries (Postgres views) if client-side aggregation gets slow
