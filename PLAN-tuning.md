# cleanReps Threshold Tuning and Parity — Plan

| | |
|---|---|
| **Status** | Not started |
| **Plan version** | 0.1 |
| **Last updated** | 2026-10-28 |

## Concept

The rules in [cleanreps/rules/](cleanreps/rules/) were tuned on two stock clips: about 10 seconds of squats with 2 reps, filmed by professionals from good angles. Users will film themselves with a phone propped on the floor, at about 20 fps on the Lite model. The thresholds have never seen that footage, so we don't know how often the app miscounts or cues the wrong thing.

This plan sets up a repeatable tuning loop: record labeled clips from home placements, score the rules against the labels per rep, pick thresholds from the data, and keep the web engine in step through parity tests that run in CI. It covers the Phase 0 exit criteria in [ROADMAP.md](ROADMAP.md) and the open tuning items in [PLAN.md](PLAN.md) and [PLAN-web.md](PLAN-web.md). The same loop later takes clips from the Phase 1 "That cue was wrong" reports.

**Targets**

- Rep count matches a human count on ≥ 95% of clean clips. This is the ROADMAP exit criterion.
- Each fault cue is right at least 90% of the times it fires (precision ≥ 0.9). Catching every fault (recall) matters less, because a wrong cue costs more trust than a missed one.
- Both targets hold for the Lite model at 15 fps, the slowest case on a phone. A pass on the Full model at 30 fps alone doesn't count.

## What exists today

| Piece | State |
|---|---|
| Rules | YAML per exercise, read by both the Python and the TS engine, so a threshold change applies to both |
| Labeled clip harness | [tests/test_replay_clips.py](tests/test_replay_clips.py) checks total reps and fault counts per clip. It skips because `tests/clips/` is empty. |
| Fixture export | [tools/export_fixtures.py](tools/export_fixtures.py) runs MediaPipe (Python) over a clip and records the raw landmarks plus what the Python engine produced for each frame |
| Engine parity | [parity.test.ts](web/src/engine/__tests__/parity.test.ts) feeds the same landmarks to the TS engine and requires the same metrics, phases, reps, faults and cues for every frame |
| CI | None. Fixtures are gitignored because they come from licensed stock clips, so the parity tests only run on one machine. |

There are gaps between what's tested and what users run:

1. **Model and frame rate.** Fixtures and replays use the Full model at the clip's 30 fps. Phones default to Lite and often process 15–20 frames a second.
2. **Rules counted in frames.** `min_frames: 4` lasts 133 ms at 30 fps but 267 ms at 15 fps, so the same movement can fault on a laptop and pass on a phone.
3. **Runtime.** Parity proves the TS engine matches the Python engine on identical landmarks. It doesn't check that MediaPipe in the browser (`@mediapipe/tasks-vision`) gives the same landmarks as Python `mediapipe==0.10.35`, so the thresholds are never checked on browser landmarks.
4. **Body proportions.** Fixtures are exported with average proportions only, so the femur and torso adjustments have no parity coverage.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Labels | **Per rep**: approximate bottom time, whether it should count, and its expected faults. The current per-clip totals stay supported. | Totals can hide errors that cancel out, such as one rep missed and one wobble counted. Per-rep labels give precision and recall for each fault. |
| Matching reps to labels | Nearest bottom time within 1 s | Labeling by eye in the `--web` viewer is accurate to about a quarter of a second, which is plenty |
| What's tuned on | **Cached landmarks**, not video. Run MediaPipe once per clip and model, then replay only the engine. | A sweep over many threshold values takes seconds instead of re-running the model, and results are deterministic. The fixture export already writes this format. |
| Models and frame rates | Cache landmarks for both Lite and Full. Score each at 30, 20 and 15 fps by dropping frames from the cache. | That covers what phones and laptops actually run, without recording every clip three times |
| Frame-based rules | Replace `min_frames` with `min_s` (a duration) in both engines | A rule should mean the same thing at any frame rate. Parity fixtures cover the change. |
| Overfitting | Split clips into a **tune** set and a **check** set, with each person in only one of them. Report the check set separately. | With only about a dozen clips it's easy to fit the thresholds to particular bodies |
| Committed data | Commit labels and **landmark-only** parity fixtures for self-recorded clips (gzipped, a few short ones). Keep video and the full landmark cache local, or in Git LFS later. | A fixture is about 3.5 KB per frame, so a 30 s clip is about 3 MB raw and much less gzipped. A small committed subset lets CI run parity; video of people's bodies stays off GitHub. |
| Runtime parity | Compare outcomes, not raw landmarks: reps and faults from browser landmarks against Python landmarks on the same clip | The two runtimes will never match bit for bit. What matters is that they reach the same verdicts. |

## Clip set (T1)

Start with 12 clips, and add more where the scores are weakest. Film with a phone propped where users would put it, at its default resolution. Get at least 3 people of different builds, with written consent to keep their landmark data.

| # | Exercise | Placement and view | Content |
|---|---|---|---|
| 1–2 | Squat | Phone on floor, side | 8 clean reps |
| 3 | Squat | Phone on chair, side | Mix of clean and too-shallow reps (`depth`) |
| 4 | Squat | Phone on a table or shelf at hip height, side | Chest drops forward (`torso_lean`), plus clean reps |
| 5 | Squat | Phone on floor, front | Knees cave in (`knee_valgus`), plus clean reps |
| 6 | Squat | Phone on chair, 45° | Clean reps, to check that the view detection holds |
| 7 | Squat | Any | Half reps (`partial`) and knees-only bends (`hip_hinge`): none should count |
| 8–9 | Push-up | Phone on floor, side | 8 clean reps |
| 10 | Push-up | Phone on floor, side | Hips sag (`hip_sag`) and pike (`hip_pike`) |
| 11 | Push-up | Phone on a table or shelf at hip height, side | Too-shallow reps (`depth`) and partials |
| 12 | Either | Poor light, busy background | Clean reps, to see what tracking loss does to counts |

**Label format**: a sidecar next to each clip in `tests/clips/`.

```json
{
  "exercise": "squat", "person": "p2", "split": "tune",
  "reps": [
    {"bottom_s": 3.4, "counted": true, "faults": []},
    {"bottom_s": 6.1, "counted": true, "faults": ["depth"]},
    {"bottom_s": 8.9, "counted": false, "faults": ["hip_hinge"]}
  ]
}
```

## The tuning loop

```
 record clip ─► label reps ─► cache landmarks (Lite + Full)
                                     │
             ┌───────────────────────┘
             ▼
 tools/tune.py report ─► edit rules YAML ─► pytest (labeled clips)
                                                 │
                                                 ▼
 try live on a phone ◄─ vitest parity ◄─ re-export fixtures
             │
             ▼
 commit rules + docs/squat.md numbers + changelog line
```

`tools/tune.py` (new) does three things:

1. **Score**: for each clip, model and frame rate, it shows rep-count accuracy and each fault's precision and recall, for the tune and check sets separately.
2. **Separation**: for each rule, it plots the metric each labeled rep reached (for example the lowest knee angle) for reps labeled with the fault and reps labeled without it, with the current threshold marked. This is usually all you need to choose a threshold: put it in the gap, closer to the faulty side.
3. **Sweep**: `--sweep squat.depth.max=90:110:2` re-scores across a range and prints a table. It never edits the YAML itself, so every change gets a human look.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| **T1 Clips** | Record the 12 clips on a phone in lab mode (`?lab=1`, "Export clip for tuning" on the summary), import each with [tools/import_lab.py](tools/import_lab.py), and correct the draft labels. The import, per-rep labels and landmark replay in [test_replay_clips.py](tests/test_replay_clips.py) are built. | Every clip has a reviewed label sidecar, and the harness runs (and probably fails) against them |
| **T2 Tools** | `tools/cache_landmarks.py` (split out of `export_fixtures.py`) for Lite and Full; frame dropping; `tools/tune.py` with score, separation and sweep | One command prints the full score table in under a minute |
| **T3 Duration rules** | `min_frames` → `min_s` in both engines, YAML and docs; re-export fixtures | Parity passes, and fault decisions on the same clip at 15 and 30 fps agree |
| **T4 Tune** | Squat first, then push-up: primary thresholds (`top`, `bottom`, `hysteresis`, `min_excursion`), then each rule. Update [docs/squat.md](docs/squat.md) to the new numbers. | Targets met on the check set for Lite at 15 fps |
| **T5 CI** | A GitHub Actions workflow running pytest and vitest. Commit gzipped parity fixtures from 3–4 short self-recorded clips, including one with long femurs to cover proportions. | A pull request that changes a rule but not the TS engine (or the other way round) fails CI |
| **T6 Runtime parity** | Record browser landmarks for the same clips (headless Edge with the clip as a fake camera, as in the playback tests) and score them with `tune.py` | Browser and Python landmarks give the same rep count on every clip, with fault verdicts differing on no more than one rep per clip |
| **T7 Ongoing** | Feed clips from Phase 1 "That cue was wrong" reports into the loop, about weekly | Wrong-cue reports trend down |

T1 and T2 can run in parallel. T3 goes before T4, so the tuning isn't done twice.

## Risks

- **Too few people.** Three bodies can't represent everyone. Separate people across the tune and check sets, and expect the first round of real users to move some thresholds again.
- **Labeling disagreement.** "Deep enough" is a judgement call. Write down what each fault means in [docs/squat.md](docs/squat.md) before labeling, and have a second person label at least two clips to check agreement.
- **MediaPipe version drift.** Python `mediapipe==0.10.35` and the web `@mediapipe/tasks-vision` are separate releases. Pin the web version too, and re-run T6 whenever either one is upgraded.
- **Consent and privacy.** Only landmarks get committed, never video, but landmarks still describe someone's body. Get written consent, use an ID like `p2` instead of a name, and delete on request.
- **Stock clip licences.** The two clips in `vids/` are licensed for local use. Their fixtures stay out of git, as they are now.

## Open questions

- Should video go in Git LFS so a second machine or contributor can re-run the full cache, or stay on one machine with a backup?
- Should the proportion adjustments (femur, torso) be tuned now, or wait until there are enough people of each build to measure them?
- Once ROADMAP Phase 2 ships rules as versioned JSON, should each rule version record the score table it was tuned against?
