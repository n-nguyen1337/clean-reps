# cleanReps — Marketing plan for the first 100 users

| | |
|---|---|
| **Status** | Web app live at https://clean-reps.pages.dev; no real users yet |
| **Last updated** | 2026-10-28 |

How to get the first 100 users: what will sell the product, what to fix before inviting anyone, who to target, and a six-week plan. It covers Phase 1 of the [roadmap](ROADMAP.md).

---

## 1. Product review, from a marketing angle

### What will sell it
- **Privacy is the strongest selling point.** Pose tracking runs on the phone and video is never uploaded. Most camera-based fitness apps can't say that, and it answers the first worry people have about pointing a camera at themselves.
- **Nothing stands between a visitor and a first set.** It's free, there's nothing to install, and no account is needed. A link in a Reddit comment can turn into a counted set within a minute.
- **The replay makes good video.** The skeleton drawn over the clip, with clean and faulty reps marked, gets attention on short-form video better than any screenshot.
- **The engineering is careful,** and that's a good story for technical audiences. Examples: squats where only the knees bend aren't counted, and the web engine is tested frame by frame against the Python one.

### What has to be fixed before getting users
1. **Nothing can be measured yet.** Page counts now go to GoatCounter, but there are no product events. Without them there's no way to tell who came back or where people quit.
2. **Testers have no way to give feedback.** There's no feedback form and no "that cue was wrong" button. In this phase, feedback is the main thing we're after.
3. **Retention will look broken on iPhones.** There's no PWA yet, and Safari deletes local history after 7 days without a visit. Exactly the testers who matter most, the ones who come back weekly, could lose their progress.
4. **Accuracy is still Phase 0.** Thresholds are tuned on 2 stock clips and 5 phone clips. Wrong cues are the biggest trust risk, and people judge on their first set.
5. **There's a fair amount to explain.** Two exercises, a `pages.dev` URL and a generic "form feedback" pitch put cleanReps in a crowded category. It needs a sharper target user (section 2).

---

## 2. Who the first 100 should be

Not "people who work out." Aim at **beginners training at home with bodyweight who aren't sure their form is right**, and specifically people doing a **push-up or squat challenge** (30-day challenges, "100 push-ups", Grease the Groove).

This group fits because:
- They already count reps, so automatic counting is useful straight away.
- A challenge gives them a reason to come back daily, which tests retention, the thing Phase 1 is meant to learn.
- Streaks, levels and achievements suit a challenge.
- Squats and push-ups are enough for them. More exercises aren't needed to start.

**Pitch:** *"A free rep counter and form checker that runs in your browser. Prop up your phone and do your set; it counts every rep and tells you when your hips sag. No app, no sign-up, and your video never leaves your phone."*

---

## 3. The plan: about 6 weeks, three stages

### Stage 0: Get ready (week 1, before inviting anyone)
- [x] **Analytics:** GoatCounter page counts (added 2026-10-28)
- [ ] **Product events:** camera allowed, set started, set finished, setup abandoned, second session within 7 days
- [ ] **Know where users came from:** a `?ref=` code on every posted link (GoatCounter reads it as the source)
- [ ] **Feedback:** a feedback link in Settings and a "wrong cue" button, even if the button only opens a prefilled form for now
- [ ] **Keep history on iPhones:** a PWA manifest plus `navigator.storage.persist()`. That's enough; a full offline service worker can wait.
- [ ] **Accuracy check:** the Phase 0 go/no-go on one iPhone and one mid-range Android. Rep counts should match a human count on 95% or more of sets.
- [ ] A custom domain if one is cheap. Optional, but it helps trust.

### Stage 1: Users 1–20, recruited by hand (weeks 2–3)
- Friends, gym friends and coworkers. **Watch 5 of them set up, in person or on a video call, without helping.** Setup (framing and camera angle) is where they'll get stuck, and this teaches more than any number of signups.
- Start a group chat (WhatsApp or Discord) and run a 2-week push-up challenge inside it. Post the group's results daily.
- Ask everyone who hits a wrong cue to send the clip. Lab export already covers the step after that.

### Stage 2: Users 20–70, communities (weeks 3–5)
Ask for **beta testers**, not attention: *"I built X, I'm looking for 30 people to try to break it."* That's allowed in more communities, gets warmer replies, and brings in the people who give feedback.
- **Reddit:** r/bodyweightfitness (it bans self-promotion, so use its daily thread or ask the mods first), r/beginnerfitness, r/calisthenics, r/homegym and r/SideProject. Read each subreddit's rules before posting.
- **Indie Hackers and dev Discords:** use the privacy and on-device engineering angle there.
- **Answer people who already need it.** Search for "is my squat form right" and "push-up form check" posts, and reply with real advice first, with the link as an extra.

### Stage 3: Users 70–100, content (weeks 4–6)
- **Short videos** (TikTok, Reels, Shorts): a bad rep next to a clean rep in the replay, the app catching sagging hips, "my phone counted my push-ups". Shoot 2–3 a week. Real faults beat polished clips.
- **Build in public** on X, Bluesky or LinkedIn with one technical post a week. Examples: how knees-only squats are kept from counting, or why the video never leaves the phone.
- Run an **open challenge** that anyone can join, with a shared hashtag. It turns the group chat into a public channel.

### Save for later
Hold these until a stranger can use the app without help (Phase 2 of the roadmap):
- Show HN and Product Hunt: there's only one first try at each.
- Paid ads and influencers.
- App stores.
- Asking for money, including pointing testers to the Donate button.

---

## 4. How to know it's working

| Metric | Target |
|---|---|
| Users (people who finished at least one set) | 100 |
| Visitor → camera allowed → set finished | Find the biggest drop and fix that step first |
| Back for a second session within 7 days | ≥ 40% |
| Still training in week 4 | ≥ 30% (the roadmap's Phase 2 gate) |
| Wrong-cue reports per 100 sets | Going down week over week |
| Testers talked to directly | All of them |

Each week, look at which `ref` sources bring people who **come back**, not just people who visit, and spend the next week on those.
