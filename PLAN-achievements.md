# cleanReps Achievements and Levels — Plan

| | |
|---|---|
| **Status** | M1–M3 implemented; M4 (tuning) not started |
| **Plan version** | 0.2 |
| **Last updated** | 2026-10-27 |

## Concept

Give people a reason to come back and to care about form, not only volume. Two systems sit on top of the existing set history:

- **Achievements:** about 60 badges for squats and push-ups, covering volume, form, depth, tempo, consistency and a few fun ones. Locked badges show progress ("640 / 1,000 squats").
- **Level and rank:** every set earns XP, mostly from *clean* reps, and XP fills a level bar. Every 5 levels is a named rank. After a set, the Summary screen shows the XP gained and a "Level up" moment when it happens.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where unlocks live | **Derived from set history**, and every unlock is also **saved on the device** (`meta` key `achievements` in IndexedDB); the two are merged, earlier unlock wins | Existing users unlock everything they've already earned on day one, and other devices derive the same unlocks from synced sets. No schema or Supabase migration. |
| Unlock date | Replay sets oldest first; an achievement unlocks at the first set that crosses its threshold | Each badge gets a real date and a link to the set that earned it. |
| Deleting a set | **Never takes an achievement away**, and its achievement XP stays. The set's own XP goes with it. | Badges should feel permanent. The badge sheet notes "that set was deleted". |
| Sign-out | Keeps only the unlocks earned by sets still on the device | The next person on a shared device doesn't inherit them. Unlocks aren't synced to the account yet: an achievement whose set was deleted before another device saw it exists only on the first device. |
| "What's new" after a set | Evaluate history **with and without** the new set and diff the two; stored unlocks from this set still count as its own | No "seen" bookkeeping. Reopened past sets list the stored unlocks whose set is that one. |
| Level scope | **One overall level** across both exercises; achievements are tagged per exercise | One number is easier to care about. Per-exercise levels can come later. |
| What earns XP | Clean reps much more than faulty ones, plus achievement XP | Rewards the thing the app is about. Tracking reps by pose already makes cheating hard. |
| Badge art | Emoji glyph on a tier-colored ring (bronze, silver, gold, platinum) | No asset pipeline for v1. Custom SVG icons can replace the glyphs later. |
| Hidden achievements | A few, shown as "???" until unlocked | Some surprise, without making most goals guesswork. |

## XP and levels

**XP per set:** `10 × clean reps + 3 × counted reps with faults + 15` for finishing a set with at least one counted rep. **XP per achievement:** bronze 25, silver 50, gold 100, platinum 250.

**Curve:** the total XP to reach level L is `50·(L−1)² + 100·(L−1)`.

| Level | Total XP | Roughly when (3 sets a week, about 15 reps each, 70% clean) |
|---|---|---|
| 2 | 150 | First set |
| 5 | 1,200 | First week (early achievements come quickly) |
| 10 | 4,950 | 2–3 months |
| 20 | 19,950 | About a year |
| 30 | 44,950 | Long-term |

**Ranks**, every 5 levels: Rookie (1–4), Trainee (5–9), Regular (10–14), Athlete (15–19), Iron (20–24), Steel (25–29), Elite (30–34), Master (35–39), Legend (40+).

All of these constants live in one file. Tune them with a small script that runs the curve over simulated histories and over a real export (M4).

## Achievements (59)

Tiers: B = bronze, S = silver, G = gold, P = platinum. "Counted reps" excludes partials. Thresholds marked † depend on the pose data and are checked against real sets in M4.

### Volume: lifetime counted reps (12)
Squat and push-up each: **First Squat / First Push-up** (B), then **100** (B), **500** (S), **1,000** (S), **5,000** (G) and **10,000** (P), titled like "1,000 Squats".

### Set records: clean reps in one set (8)
Squat and push-up each: **10** (B), **20** (S), **30** (G), **50** (P).

### Flawless sets: every counted rep clean, no partials (8)
Squat and push-up each: **Flawless 5**, i.e. a flawless set of at least 5 reps (B); **Flawless 10** (S); **Flawless 20** (G). Across both exercises: **Perfectionist**, 10 flawless sets (S), and **Machine**, 50 flawless sets (G).

### Fault fixed (7)
A set where a fault showed up in at least 50% of reps, followed later by a set of at least 5 reps with none of it. One per rule: squat `depth`, `hip_hinge`, `torso_lean`, `knee_valgus`; push-up `depth`, `hip_sag`, `hip_pike` (S each). Names like *Hips Back*, *Chest Up*, *Knees Out*, *Solid Core*.

### Depth and tempo (6)
| Name | Rule | Tier |
|---|---|---|
| Below Parallel | Squat set of at least 5 reps, median knee angle at the bottom ≤ 90° † | S |
| Chest to Floor | Push-up set of at least 5 reps, median elbow angle at the bottom ≤ 80° † | S |
| Controlled | A set of at least 5 reps with an average lowering time of 2–3 s | B |
| Slow and Steady | 10 controlled sets | S |
| Form Streak | 5 sets in a row of one exercise at ≥ 90% clean | S |
| Glow Up | Average clean % of the latest 5 sets is ≥ 20 points above the first 5 | G |

### Consistency (11)
- **Week streak** (uses `weekStreak`): 2 (B), 4 (B), 8 (S), 12 (S), 26 (G), 52 (P)
- **Total sets:** 10 (B), 50 (S), 100 (G), 250 (P)
- **Regular:** 12 training days in one calendar month (S)

### Volume in a session (4)
- **Big Day:** 100 counted reps in one day (S)
- **Big Week:** 300 counted reps in one week (S)
- **Full Body:** squats and push-ups on the same day (B)
- **All-Rounder:** both exercises in each of 4 consecutive weeks (S)

### Fun and hidden (3 + hidden)
- **Early Bird:** a set started before 7:00 (B)
- **Night Owl:** a set started after 22:00 (B)
- **Comeback:** a set after 30 or more days with none (B)
- *Hidden:* **Even Hundred**, a set of exactly 100 counted reps (G); **New Year, New Reps**, a set on 1 January (B); **Double Ton**, 200 clean reps in one day (G)

That's 12 + 8 + 8 + 7 + 6 + 11 + 4 + 3 = 59 visible achievements, plus 3 hidden ones (62 total).

## Architecture

```
SetRecord[] (useSets, already live)
      │  oldest first
      ▼
replay(sets) ──► running Stats ──► each locked AchievementDef.check(stats, set)?
      │                               └─ unlocked { id, at: set.started, setId }
      ▼
Progression { unlocked[], progress per locked id, xp, level, rank, xpIntoLevel, xpForNext }
```

- **`web/src/store/achievements.ts`:** the `AchievementDef` list as data, `{ id, title, description, exercise?, category, tier, hidden?, check(stats, set), progress?(stats) → { value, target } }`, plus `replay(sets)`. `Stats` holds running totals (reps per exercise, flawless count, per-day and per-week buckets, fault history, the streak as of each set). The cost is O(sets × defs), a few ms for thousands of sets.
- **`web/src/store/level.ts`:** XP per set, the curve, ranks, and `levelFor(xp)`.
- **`progression(sets, stored)`** combines both with the stored unlocks. `setProgress(sets, set, stored)` diffs it with and without one set: XP gained, levels crossed, newly unlocked achievements.
- Reuse `weekStart`, `weekStreak` and `analyze()` (for depth) from `progress.ts` and the engine, without duplicating them.
- Memoized in `App.tsx`, which also saves new unlocks (`saveUnlocks` in `db.ts`). No new IndexedDB tables or Supabase work.

## UI

### Progress page
1. **Level card** at the top, above the exercise picker (it's overall): rank name and level, an XP bar ("340 / 500 XP to Level 8"), and the total achievement count ("23 / 59").
2. The existing per-exercise stats and trends, unchanged.
3. **Achievements teaser:** the 3 most recent unlocks and the 3 closest to unlocking (highest progress %), then **See all**.
4. **Achievement board** (its own screen, so the Progress page stays short on a phone): a grid of badges with the filters All / Squat / Push-up / Unlocked, grouped by category. Locked badges are greyed out with a progress bar. Tapping one opens a sheet with the description, the unlock date and **Open set**, which reuses the existing past-set Summary.

### Summary screen (live sets only)
- "+135 XP" and an XP bar that animates from before to after.
- **Level up** banner when a level is crossed, which also names the new rank when the rank changes.
- A "New achievements" row of badges unlocked by this set.
- Reopened past sets show "Earned in this set" without the animation.
- Respect `prefers-reduced-motion`.

## Milestones

### M1 — Engine (no UI)
- [x] `level.ts`: XP, the curve and ranks
- [x] `achievements.ts`: `Stats`, `replay`, all definitions
- [x] `progression()` and `setProgress()`; unlocks saved on the device
- [x] Tests: each category against handcrafted histories; unlock date and set; deleting a set keeps its unlocks; the delta for the newest set; the definition count stays at 59 visible

### M2 — Progress page
- [x] Level card and the achievement teaser
- [x] Achievement board screen with filters and the detail sheet
- [ ] Mobile layout check at 360 px

### M3 — Summary celebration
- [x] XP gained, the animated bar, the level-up banner, new badges
- [x] "Earned in this set" on reopened sets

### M4 — Tuning
- [ ] Script: run the curve over simulated users and a real JSON export; adjust the constants
- [ ] Check the † depth thresholds against real sets

## Risks

| Risk | Mitigation |
|---|---|
| Thresholds retuned later change which reps were clean | Each set keeps its own stored results, so past unlocks don't move |
| The curve feels too slow or too fast | Constants live in one file; the M4 simulation; levels are derived, so a retune applies retroactively with no migration |
| Leveling up by grinding sloppy reps | Faulty reps earn less than a third of the XP of a clean rep, and partials earn nothing |
| Replay gets slow over a long history | Memoized; at about 60 definitions it stays in milliseconds well past 10k sets. Cache per prefix if that ever changes. |
| Adding an exercise later | Definitions are data with an `exercise` tag; per-exercise families are generated by a helper |

## Later

- Per-exercise levels
- Custom SVG badge art
- Share a badge or level-up as an image
- Weekly challenges, which would need stored state and so don't fit the derived model
