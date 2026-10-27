# cleanReps App Shell: Home, Progress, About — Plan

| | |
|---|---|
| **Status** | M0–M4 implemented; M5 needs testing on real phones |
| **Plan version** | 0.1 |
| **Last updated** | 2026-10-27 |

## Concept

The home screen is currently one long setup form: exercise, build, settings, account and Start, with "About" collapsed in a `<details>` block. Progress is reached through a pill button and left through a Back button, and the phone's back button leaves the app.

This plan splits the app into three pages behind a bottom tab bar, **Home**, **Progress** and **About**, plus a **Settings** page reached from Home. Everything is designed for a phone first, at about 360px wide, and wider screens are layered on top.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Scope | The app's home screen, not a separate marketing site | The app is the product; no SEO requirement |
| Navigation | **Bottom tab bar** (Home · Progress · About); a top nav from 768px | Reachable one-handed; the usual pattern for a phone app |
| Routing | **Hash routes**, from a small `useRoute` hook; no router dependency | Works with `base: "./"` on GitHub Pages and on Cloudflare Pages with no fallback rules. The back button works and pages can be bookmarked. |
| Live set and Summary | Stay as in-memory state, full screen, with no tab bar | They hold a camera stream and a playback object, which can't be restored from a URL. Leaving them returns to the route underneath. The session pushes one history entry: back during a set finishes it; back on the Summary closes it. |
| Settings | **Its own page**, `#/settings`, opened from a gear in the Home header | Keeps the tab bar to three. Holds the account panel and the rarely changed training options. |
| Training options on Home | A one-line summary ("Average build · Voice on · Lite") that links to Settings | Home stays focused on starting a set, while the current choices stay visible |
| Theme | Dark only, as today | Out of scope |

## Routes

| Route | Page | Notes |
|---|---|---|
| `#/` | Home | Default; unknown routes land here |
| `#/progress` | Progress | |
| `#/progress/achievements` | Achievement board | Back goes to Progress |
| `#/set/:id` | Past set (Summary) | Shows "Set not found" if the set was deleted or hasn't synced |
| `#/about` | About | |
| `#/settings` | Settings | Back arrow in the header; no tab is highlighted |

## Pages

### Home
- **Header:** the cleanReps wordmark, with a gear on the right that opens Settings.
- **First visit** (no sets yet): a hero with one line on what the app does and one on privacy, a three-step "how it works" strip (pick, prop, train), and a link to About.
- **Returning user:** a welcome-back card showing level, an XP bar and the week streak (reusing `LevelCard` from Achievements), plus one line about the last set ("Squats yesterday · 14 reps, 11 clean").
- **Exercise cards:** as they are now. The last exercise trained is preselected.
- A summary of the training options that links to Settings.
- **Start:** a full-width button pinned above the tab bar, so it's always in reach.
- The disclaimer, below the fold.

### Progress
- The level card and achievement teaser, as now.
- The exercise switcher stays pinned under the header while you scroll.
- History shows the last 10 sets, with a "Show all" button.
- Export JSON moves into a small "⋯" menu in the header.
- The Back button is removed; the tab bar replaces it.
- From 768px: the trend charts sit in two columns.

### About
The content of the current `<details>` block, as a full page with short sections that are easy to skim:
- **How it works:** the five steps.
- **Camera setup:** each exercise's `cameraHint`, taken from its config so the two can't drift apart.
- **Privacy:** on-device pose tracking; replay is kept in memory only.
- **Optional sign-in:** backup, sync and the AI review.
- **Tips:** lighting, clothing, and the Lite model.
- **Disclaimer** and the app version (`__APP_VERSION__`).

### Settings
- **Your build:** femur and torso, shown only when an exercise uses body proportions.
- **Training:** spoken cues, record for replay, and the model.
- **Account:** `AccountPanel`, moved from Home.
- Settings already save to `localStorage`. Voice and the model become persistent too; today they reset on every visit.

## Architecture

- `web/src/route.ts`: `useRoute()` parses `location.hash` and listens for `hashchange`; `navigate(path)` sets the hash.
- `App.tsx` keeps the shared state (sets, unlocks, progression, settings, account) and the overlay for the live set and Summary, and renders the page for the current route inside `<Shell>`.
- New files: `ui/Shell.tsx` (the tab bar and page frame), `ui/Home.tsx`, `ui/About.tsx`, `ui/Settings.tsx`.
- Settings state moves into a `store/settings.ts` hook, so Home and Settings read from the same source.
- Starting a set still calls `speaker.unlock()` inside the tap handler, which iOS requires.

## Styles (mobile first)

- Base styles target about 360px; a `min-width: 768px` query adds the desktop layout. The only width-limited rule is the pinned Start button (phones at least 640px tall).
- Spacing tokens (`--space-1` to `--space-6`) and safe-area insets (`env(safe-area-inset-bottom)`) for the tab bar and the pinned Start button.
- Page padding at the bottom equals the tab bar height plus the safe area, so nothing hides behind the bar.
- Tap targets are at least 48px, and focus rings are visible.
- Tab bar: icon and label, with the active tab in `--accent` and marked `aria-current="page"`. Icons are inline SVG; there's no icon library.

## Milestones

### M0 — Branch hygiene
- [x] Commit the achievements work on `feature/progression-v2`, then branch `feature/app-shell` from it

### M1 — Shell and routing (no redesign)
- [x] `useRoute` / `navigate`, with unit tests for parsing and unknown routes
- [x] `Shell` with the tab bar; the live set and Summary render without it
- [x] Move the existing Home markup into `ui/Home.tsx`; drop the Back button on Progress
- [x] The achievements and past-set screens become routes

### M2 — About and Settings
- [x] About page, from the `<details>` content and the exercise configs
- [x] Settings page, with build, training options and account; `store/settings.ts`; voice and model persist

### M3 — Home redesign
- [x] Header with the gear; first-visit and returning-user states
- [x] Settings summary line; preselect the last exercise; pinned Start

### M4 — Progress polish
- [x] Pinned exercise switcher, history trimmed to 10, export in the "⋯" menu

### M5 — Responsive and device pass
- [x] 768px layout: top nav, two-column charts
- [x] Accessibility: focus rings, `aria-current` on tabs, radio roles on exercise cards (contrast unchanged from the existing palette)
- [ ] Test on real phones: iOS Safari (including from the home screen) and Android Chrome

## Risks

| Risk | Mitigation |
|---|---|
| The back button during a live set leaves the page with the camera still on | Push a history entry when a set starts; on `popstate`, end the set cleanly, the same as tapping Stop |
| The pinned Start and the tab bar crowd small screens | At heights under 640px, Start stays in the page flow instead of being pinned |
| A deep link to `#/set/:id` before sync has loaded | Show a loading state until `useSets()` resolves, then "Set not found" |
| iOS Safari's toolbar covers fixed elements | Use `100dvh` and safe-area insets; check on a device in M5 |

## Later
- Light theme
- Install prompt (PWA manifest) once the shell is stable
- Per-exercise landing cards with a short demo loop
