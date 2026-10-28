# How CleanReps judges a squat

This document explains how CleanReps decides that a squat happened, and whether it was a *good* squat. Everything here comes from three files:

- [`cleanreps/exercises/squat.py`](../cleanreps/exercises/squat.py): which body measurements are taken each frame
- [`cleanreps/rules/squat.yaml`](../cleanreps/rules/squat.yaml): the thresholds and coaching cues
- [`cleanreps/exercises/base.py`](../cleanreps/exercises/base.py): the rep state machine and rule engine shared by all exercises

The TypeScript engine in [`web/src/engine/`](../web/src/engine/) is a port of the same logic and uses the same numbers.

## In short

A rep **counts** when the knee angle drops from standing to below 120° and comes back up to standing (within 10° of how you stood when you got ready; see section 4), the hips bent (hip angle below 120°), and the hips dropped (below 0.74 of leg length over the ankles). Bending only the knees isn't a squat, and neither is hinging forward without sitting down, so neither counts.

A counted rep is **clean** (and plays the chime) when none of these faults happened during it:

| Fault | What it means | Measured as | Fault when | Cue |
|---|---|---|---|---|
| `depth` | Didn't squat deep enough | Lowest hip height in the rep (hips over ankles ÷ leg length) | above 0.58 | "Squat a little deeper" |
| `torso_lean` | Chest dropped forward too far | Torso angle from vertical (side view) | above 50° (40–65° depending on your build, see section 7) | "Chest up" |
| `knee_valgus` | Knees caved inward | Knee spread ÷ ankle spread (front view) | below 0.8 for 4+ frames | "Push your knees out" |

These faults stop the rep from counting at all:

| Fault | What it means | Measured as | Fault when | Cue |
|---|---|---|---|---|
| `partial` | Started a squat but never reached the bottom | Knee angle didn't reach 120° | dip of 25° or more | "Go deeper" |
| `hip_hinge` | Bent the knees but not the hips | Lowest hip angle in the rep | above 120° | "Sit your hips back" |
| `hips_high` | Hinged forward without sitting down, as in an RDL | Lowest hip height in the rep | above 0.74 | "Bend your knees and sit down" |

A rep stopped by `hip_hinge` or `hips_high` reports only that fault, not depth or form: it wasn't a squat. A dip that would be a `partial` is dropped silently if one of them fires, so walking up to the phone at the end of a set isn't a partial rep.

The rest of this document explains where each of these numbers comes from.

## 1. From video to body landmarks

Each camera frame goes through MediaPipe Pose Landmarker, which returns 33 body landmarks in two coordinate systems:

- **Image coordinates**: pixel positions on the screen. Used for anything that depends on what the camera sees, such as lean relative to the vertical or the left/right spread of the knees.
- **World coordinates**: 3D positions in metres, centred on the hips. Used for joint angles, because they are not distorted by perspective the way a 2D projection is.

Each landmark also comes with a **visibility** score. A measurement is only taken when every landmark it needs has visibility ≥ 0.5. Otherwise that metric is left empty for the frame, and no fault can come from it.

Raw landmarks jitter from frame to frame, so they go through a **One Euro filter** ([`filters.py`](../cleanreps/filters.py)). The filter smooths heavily when the body is still and lightly when it moves fast, which removes jitter without adding noticeable lag mid-rep.

## 2. Camera view and body side

Some faults can only be seen from certain angles, so the squat first works out how it is being filmed.

- **Which side?** The engine uses whichever side (left or right) has the more visible hip, knee and ankle. From a side view, that is the side facing the camera.
- **Front or side view?** It compares shoulder width with torso length (shoulder midpoint to hip midpoint). If shoulder width is at least 0.45 × torso length, the shoulders are spread across the image, so it is a **front** view. Otherwise it is a **side** view.

| Camera view | What can be judged |
|---|---|
| Side | Depth, hip hinge, hips staying high, torso lean |
| Front | Depth, hip hinge, hips staying high, knee tracking (valgus) |

That is why the camera hint says: *"Side view for depth and torso lean; front view for knee tracking."*

## 3. The five squat metrics

These are computed on every frame ([`squat.py`](../cleanreps/exercises/squat.py)).

### Knee angle (primary metric)

The angle at the knee between the thigh (knee → hip) and the shin (knee → ankle), computed in 3D world coordinates.

- About **175°** when standing tall
- About **90°** with thighs parallel to the floor
- Smaller numbers mean a deeper squat

This is the **primary metric**: it drives rep counting (section 4). It used to drive the depth check too, but from the front the model can't see the thighs moving toward or away from the camera, so a half squat and an RDL both read as 82–126°. Depth now comes from hip height.

### Hip angle

The angle at the hip between the torso (hip → shoulder) and the thigh (hip → knee), in 3D. About **170°** standing, and typically **40–90°** at the bottom of a real squat. If it never drops below **120°**, the knees bent without the hips sitting back, and the rep doesn't count (`hip_hinge`).

### Hip height

How high the hips are over the ankles, as a fraction of leg length, using the side the engine picked (section 2), in 3D world coordinates:

```
hip_height = (ankle y − hip y) / (hip→knee length + knee→ankle length)
```

About **0.97** standing, **0.2–0.5** at or below parallel. Unlike the knee angle, it's mostly a vertical distance, which the model measures well from the front and the side alike. From clips recorded at home (front and side, phone on a table or the floor):

| Movement | Lowest hip height |
|---|---|
| Deep squats | 0.18–0.52 |
| Shallow squats | 0.65–0.70 |
| RDLs and steps while walking | 0.78–0.88 |

The two limits sit in the gaps: `depth` faults above **0.58**, and `hips_high` stops the rep from counting above **0.74**.

### Torso lean (side view only)

The angle between the hip → shoulder line in the image and straight up. 0° means fully upright, 90° means the torso is horizontal. Some forward lean is normal in a squat. Above **50°** the chest has dropped too far.

### Knee ratio (front view only)

```
knee_ratio = horizontal distance between knees / horizontal distance between ankles
```

When the knees track over the toes, this is about 1.0 or higher. When the knees collapse inward (knee valgus), it falls. Below **0.8** counts as a fault. If the ankles are almost on top of each other (less than 1 px apart), the ratio is skipped so the engine never divides by roughly zero.

## 4. Counting a rep: the state machine

Rep counting uses the knee angle and four phases. *Top* is a threshold learned from how you stand (see "Learning how you stand" below), between 145° and 160°:

```
           knee < top − 8°             knee ≤ 120°
   TOP ─────────────────▶ DESCENDING ─────────────────▶ BOTTOM
    ▲                         │                           │
    │        knee ≥ top       │                           │ knee > 128°
    │  (aborted: maybe a      │                           ▼
    │   partial rep)          │                       ASCENDING
    ◀─────────────────────────┘                           │
    ▲                                                     │
    └──────────────── knee ≥ top: rep counted ◀───────────┘
                      (and ASCENDING → BOTTOM again if knee ≤ 120°)
```

The thresholds come from `squat.yaml`:

| Setting | Value | Role |
|---|---|---|
| `top_threshold` | 160° | Standing tall. The most a learned top can be, and the top before one is learned. |
| `top_margin` | 10° | Learned top = how you stand while getting ready, minus this. |
| `top_floor` | 145° | The least a learned top can be. |
| `bottom_threshold` | 120° | Deep enough to count as a rep. |
| `hysteresis` | 8° | Dead band so noise near a threshold doesn't flip the phase back and forth. To *leave* TOP you must go below top − 8°. To *leave* BOTTOM you must go above 120 + 8 = 128°. |
| `min_excursion` | 25° | Dips smaller than this are ignored instead of being reported as partial reps. |
| `ready_s` | 0.75 s | Time standing (knee ≥ 152°) before the first rep can start. Default; not set in the YAML. |

**Getting ready.** Nothing counts until you have stood upright, tracked, for 0.75 seconds. Getting up from the phone after tapping Start, or a step while walking into place, isn't a rep. Until then the screen says "Hold still in your start position". The 0.75 s comes from clips recorded at home: false starts came after at most 0.4 s of standing, and people stand at the top for at least 0.5 s between reps. It only applies before the first rep, so fast reps mid-set aren't affected.

**Learning how you stand.** The same straight leg measures about 10° differently from the front and from the side: the Lite model reads it as 156–169° from the front and 166–175° from the side. A fixed top of 160° left some front-view sets less than a degree of margin, so reps merged when someone stood up to 159°. Instead, while you get ready, the engine takes the lower quartile of your knee angle as "standing" and puts the top 10° below it, between 145° and 160°. It uses the lower quartile rather than the median because people often stand extra tall while getting ready and relax between reps. If tracking is lost for 2 seconds, it learns again when you settle.

**Partial reps.** If you start going down (below top − 8°) but stand back up (≥ top) without reaching 120°, the rep is not counted. If the lowest knee angle was at least 25° below how you stand (capped at 160°, so at most 135°), it was a real attempt, so it is reported as a `partial` rep with the cue "Go deeper". Smaller dips, such as shifting your weight, are dropped silently. This depth is measured from your standing angle, not the learned top: from a top of 145°, a 25° dip would already reach 120° and count as a rep, so "Go deeper" would never be said.

**Losing tracking.** If the knee angle can't be measured (for example, a leg leaves the frame) for 1 second, the cue "Step back so your whole body is visible" is shown. After 2 seconds, an in-progress rep is abandoned, the phase resets to TOP, and you have to settle again before the next rep counts.

**Tempo.** Every rep records when it started, when it reached the bottom and when it ended, which gives the **eccentric** time (start to bottom) and **concentric** time (bottom to end).

## 5. Judging form: the rule engine

While a rep is in progress, the engine records the minimum and maximum of every metric. Rules then check those values in one of two ways.

### Rep rules: checked once, when the rep finishes

A rule with `aggregate: min` or `max` is checked against that metric's extreme over the whole rep.

- **`depth`**: the *lowest* hip height in the rep must be ≤ 0.58.
- **`hip_hinge`**: the *lowest* hip angle in the rep must be ≤ 120°. This rule has `no_rep: true`, so when it fires the rep is reported as not counted (like a partial) instead of a counted rep with a fault.
- **`hips_high`**: the *lowest* hip height in the rep must be ≤ 0.74. Also `no_rep: true`.

Note the three levels of hip height. Above **0.74** the hips never really dropped, so it wasn't a squat and doesn't count. Between **0.58 and 0.74** it was a shallow squat: it counts, but you get "Squat a little deeper". Below **0.58** it's deep enough to be *clean*. This rewards real effort while still steering you toward parallel.

### Live rules: checked on every frame during the rep

A rule without `aggregate` is checked continuously. It only fires after it has been broken for `min_frames` frames in a row, so one noisy frame can't trigger it.

- **`torso_lean`**: torso angle > 50° for 3 consecutive frames (the default)
- **`knee_valgus`**: knee ratio < 0.8 for 4 consecutive frames (stricter, because knee landmarks are noisier from the front)

Live faults are cued straight away, in the middle of the rep, while you can still correct them. Each fault is recorded at most once per rep.

## 6. Feedback to the user

Faults turn into cues with a **priority**: depth, partial, hip hinge and hips high = 3, torso lean and knee valgus = 2, tracking = 1, good rep = 0. The cue manager ([`feedback.py`](../cleanreps/feedback.py)):

- shows one cue at a time, for 2 seconds
- lets a higher-priority cue replace a lower-priority one early
- doesn't repeat the same cue within 4 seconds, so a fault that keeps happening doesn't spam you

A rep that is counted and has no faults is **clean**, and plays a short chime.

## 7. Body proportions

People with different proportions squat differently. To stay balanced, the bar has to stay over the middle of the foot, so the hips have to sit back as far as the thighs reach. With **long femurs** (thighs), the hips travel further back and the chest has to tip further forward to compensate. A **short torso** has the same effect. Short femurs or a long torso let you stay more upright.

So the app asks two questions before a squat session:

- **Your thighs (femurs)** compared with your torso: short, average or long
- **Your torso** compared with your legs: short, average or long

In the web app these are under *Your build* on the start screen, and your answers are remembered on that device. In the desktop app, use `--femur` and `--torso`, for example `python -m cleanreps --femur long --torso short`. If you're not sure, leave both on *average*.

The answers shift the `torso_lean` limit:

| | Femur short | Femur average | Femur long |
|---|---|---|---|
| **Torso long** | 40° | 45° | 53° |
| **Torso average** | 45° | 50° | 58° |
| **Torso short** | 52° | 57° | 65° |

These adjustments are in the `proportions` section of [`squat.yaml`](../cleanreps/rules/squat.yaml). Each entry adds an amount to a rule's limits. For example, `femur: {long: {torso_lean: 8}}` raises the lean limit by 8° for long femurs, and the femur and torso amounts add together. Depth and knee tracking stay the same for every build. Depth is measured with the knee angle, which reaches about 90° at parallel whatever your proportions, and knees caving in is a fault for everyone.

## 8. Tuning

All the numbers above live in [`squat.yaml`](../cleanreps/rules/squat.yaml), so you can tune them without changing code. The web engine imports the same file, so one edit changes both apps. For example, raise `depth.max` to 110 for a beginner-friendly mode, or lower `torso_lean.max` for high-bar or front-squat coaching. The config loader rejects a `bottom_threshold` that is not below `top_threshold`, and rules that refer to metrics the squat doesn't compute.

When you change a threshold, run the replay tests ([`tests/test_replay_clips.py`](../tests/test_replay_clips.py)) and the web parity test ([`web/src/engine/__tests__/parity.test.ts`](../web/src/engine/__tests__/parity.test.ts)) to keep the Python and TypeScript engines in agreement.
