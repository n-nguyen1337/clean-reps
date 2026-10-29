# cleanReps — Product overview

| | |
|---|---|
| **Status** | Web app live at https://clean-reps.pages.dev; no real users yet |
| **Last updated** | 2026-10-28 |

What cleanReps is, the problem it solves, and who it's for. For what gets built when, see the [roadmap](ROADMAP.md); for how to reach the first users, see the [marketing plan](MARKETING.md).

---

## 1. What it is

cleanReps is a free web app that counts your reps and checks your form through your phone or laptop camera. You prop up the device, start a set, and it tracks your joints, counts each rep, and calls out form problems out loud while you train. Afterwards you can replay the set with your skeleton drawn over the video and watch your progress over the weeks.

Pose tracking runs on the device. Video is never uploaded, and there's nothing to install and no account to make.

**In one line:** a training partner that counts every rep and tells you when your form slips, without the trainer, the app store or the cloud.

---

## 2. The problem

People training on their own at home have three problems that a coach would normally solve:

1. **They can't see their own form.** You can't watch your hips during a push-up or your knees during a squat. Bad reps go unnoticed and turn into habits: half squats, sagging hips, knees caving in. Over time that means slower progress and a higher risk of strain.
2. **Feedback is expensive or slow.** A personal trainer costs money and needs scheduling. Filming yourself and posting "form check?" online takes days to get answers, and the answers come after the workout, not during it.
3. **Counting gets in the way.** Keeping count while thinking about form, breathing and fatigue is hard. People lose count, or count half reps as full reps, so their numbers mean less than they think.

Existing camera-based fitness apps address part of this. Most need an install, an account or a subscription, and many process video on their servers, which puts off people training in their living room or bedroom.

---

## 3. How cleanReps solves it

| Problem | What cleanReps does |
|---|---|
| Can't see your own form | Spoken cues during the set (*"go deeper"*, *"hips up"*) and a chime on each clean rep, so you can correct the next rep, not next week's workout |
| Feedback is expensive or slow | Instant and free. After the set, a replay with the tracked skeleton, per-rep depth, tempo and form charts, and tips on what to work on |
| Counting gets in the way | Reps are counted automatically. Partial reps and knees-only squats don't count, so the number is honest |
| Privacy worries about cameras | Pose tracking runs in the browser; video never leaves the device. History is stored on the device unless you choose to sign in |
| Friction of apps and accounts | It's a web page: open the link and train. Sign-in is optional, only for backup, sync and the AI review |

### What it checks today

| Exercise | Form checks |
|---|---|
| **Squat** | Depth, torso lean (adjusted for body build), knees caving in; knees-only squats aren't counted |
| **Push-up** | Depth, sagging hips, piked hips, lockout at the top |

### Beyond the set
- **Progress:** reps, form score, depth and tempo trends; personal records and weekly streaks
- **Motivation:** 59 achievements, XP and levels
- **AI review (optional, signed in):** a short written review of each set, based on the set's numbers only

---

## 4. Target audience

### Primary: home bodyweight beginners
People training at home with bodyweight exercises who aren't sure their form is right.

- **Who they are:** adults new to training or coming back to it, training at home or in a small space, often 20–40, usually with a phone and not much equipment
- **What they want:** to get stronger without getting hurt, to know their reps "count", and to see progress
- **What holds them back:** no one to check their form, trainers cost too much, gyms are intimidating, they don't want to film themselves and upload it
- **Where they are:** r/bodyweightfitness, r/beginnerfitness, r/calisthenics, fitness TikTok and Reels, workout challenge groups

### The first group to target: challenge-doers
People doing a push-up or squat challenge (30-day challenges, "100 push-ups", Grease the Groove). They're the starting point because:
- they already count reps, so automatic counting is useful from day one;
- a challenge brings them back daily, which shows whether the app keeps people;
- streaks and achievements suit how they train;
- squats and push-ups are exactly what they're doing.

### Secondary audiences
- **Privacy-conscious people** who avoid fitness apps that upload video
- **Self-coached lifters** who want an honest rep count and depth check on bodyweight warm-ups and accessory work
- **Tech-curious people** drawn in by on-device pose tracking, who often become early testers and share it

### Not the audience (for now)
- **Rehab or physio patients.** cleanReps gives fitness feedback, not medical advice; rehab use would need clinical validation and legal review.
- **Heavy barbell lifters.** Equipment, gym lighting and camera placement make this a different problem.
- **People who want full guided programs** with video instruction. cleanReps checks the reps you do; it doesn't yet plan workouts (planned for Phase 2).

---

## 5. Why cleanReps is different

- **Private by design:** video never leaves the device. This is a real difference, not a policy promise.
- **No barrier to the first set:** free, browser-based, no install, no account.
- **Honest counting:** partial reps and knees-only squats aren't counted, and cues adjust for body build.
- **Costs almost nothing to run:** pose tracking uses the user's device, so the free core can stay free. Paid features, if any, will be the ones with a real per-user cost, such as the AI review.

---

## 6. Current limits

- **Two exercises** (squat and push-up). Plank and lunge are next.
- **Accuracy is still being proven:** thresholds are tuned on a small set of clips, and the app hasn't been tested yet with real users in real homes.
- **Needs a decent camera setup:** whole body in frame, reasonable light, the camera at the angle each exercise asks for. There's no guided setup flow yet.
- **Not installable yet:** no PWA, so iPhone users can lose local history after 7 days without a visit unless they sign in.

---

## 7. Principles

1. **Video stays on the device.** Any future feature that shares footage, such as clip donation for tuning, is opt-in, with clear consent and deletion.
2. **Wrong cues are worse than no cues.** When tracking is unsure, the app should stay quiet.
3. **Fitness, not medicine.** No health or injury-prevention claims; a disclaimer on first visit.
4. **The core stays free.** Counting, cues, replay and progress cost nothing to run per user, so they stay free.
