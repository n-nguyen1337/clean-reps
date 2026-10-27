// Achievements, derived by replaying set history oldest first: each one
// unlocks at the first set that crosses its threshold. Unlocks are also kept
// on the device (db.ts), so deleting a set never takes one away.

import { levelFor, setXp, TIER_XP, type Level, type Tier } from "./level";
import { median, weekStart } from "./progress";
import type { SetRecord } from "./record";

export type Category = "volume" | "records" | "flawless" | "form" | "technique" | "consistency" | "sessions" | "fun";

export const CATEGORIES: Record<Category, string> = {
  volume: "Volume", records: "Set records", flawless: "Flawless sets", form: "Fault fixed",
  technique: "Depth and tempo", consistency: "Consistency", sessions: "Big sessions", fun: "Just for fun",
};

export const EXERCISES: Record<string, { name: string; noun: string; emoji: string }> = {
  squat: { name: "Squat", noun: "squats", emoji: "🦵" },
  pushup: { name: "Push-up", noun: "push-ups", emoji: "💪" },
};

export interface Unlock {
  /** When the set that earned it started. */
  at: string;
  setId: string;
}
export type Unlocks = Record<string, Unlock>;

/** Running totals and bests over the sets replayed so far, keyed like "reps:squat". */
export interface Stats {
  n: Record<string, number>;
  /** "exercise:rule" pairs with a set where the fault showed up on at least half the reps. */
  faulted: Set<string>;
  cleanPcts: Record<string, number[]>;
  days: Map<string, { reps: number; clean: number; exercises: Set<string> }>;
  weeks: Map<number, Set<string>>;
  months: Map<string, Set<string>>;
  formRun: Record<string, number>;
}

/** The set being replayed. */
export interface SetCtx {
  set: SetRecord;
  exercise: string;
  started: Date;
  reps: number;
  clean: number;
  /** Median bottom of the primary metric over counted reps. */
  depth: number | null;
  /** Days since the previous set, if any. */
  gapDays: number | null;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  emoji: string;
  tier: Tier;
  category: Category;
  exercise?: string;
  hidden?: boolean;
  /** Counter achievements unlock when `stats.n[key]` reaches `target`, which also drives the progress bar. */
  key?: string;
  target?: number;
  check?: (c: SetCtx, s: Stats) => boolean;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const TIERS: Tier[] = ["bronze", "silver", "gold", "platinum"];

const FIXES: { exercise: string; rule: string; title: string; emoji: string; what: string }[] = [
  { exercise: "squat", rule: "depth", title: "Deeper", emoji: "📏", what: "shallow squats" },
  { exercise: "squat", rule: "hip_hinge", title: "Hips Back", emoji: "🪑", what: "squatting with only your knees" },
  { exercise: "squat", rule: "torso_lean", title: "Chest Up", emoji: "🧍", what: "leaning too far forward" },
  { exercise: "squat", rule: "knee_valgus", title: "Knees Out", emoji: "↔️", what: "knees caving in" },
  { exercise: "pushup", rule: "depth", title: "All the Way Down", emoji: "⬇️", what: "shallow push-ups" },
  { exercise: "pushup", rule: "hip_sag", title: "Solid Core", emoji: "🧱", what: "sagging hips" },
  { exercise: "pushup", rule: "hip_pike", title: "Flat Back", emoji: "📐", what: "piked hips" },
];

function hasFixed(c: SetCtx, s: Stats, rule: string): boolean {
  const def = c.set.config.rules.find((r) => r.id === rule);
  if (!def || c.reps < 5 || !s.faulted.has(`${c.exercise}:${rule}`)) return false;
  if (c.set.reps.some((r) => r.faults.includes(rule))) return false;
  // Side- or front-only metrics: a set filmed from the other view can't show the fix.
  const counted = c.set.reps.filter((r) => r.counted);
  return counted.filter((r) => r.extremes[def.metric]).length * 2 >= counted.length;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function buildDefs(): AchievementDef[] {
  const defs: AchievementDef[] = [];
  for (const [ex, { name, noun, emoji }] of Object.entries(EXERCISES)) {
    const Noun = noun[0].toUpperCase() + noun.slice(1);
    [1, 100, 500, 1000, 5000, 10000].forEach((n, i) => defs.push({
      id: `${ex}-reps-${n}`, exercise: ex, category: "volume", emoji, tier: TIERS[[0, 0, 1, 1, 2, 3][i]],
      title: n === 1 ? `First ${name}` : `${fmt(n)} ${Noun}`,
      description: n === 1 ? `Count your first ${name.toLowerCase()}.` : `Count ${fmt(n)} ${noun} in total.`,
      key: `reps:${ex}`, target: n,
    }));
    [10, 20, 30, 50].forEach((n, i) => defs.push({
      id: `${ex}-set-${n}`, exercise: ex, category: "records", emoji: "🏆", tier: TIERS[i],
      title: `${n} Clean ${Noun}`, description: `Do ${n} clean ${noun} in one set.`, key: `clean:${ex}`, target: n,
    }));
    [5, 10, 20].forEach((n, i) => defs.push({
      id: `${ex}-flawless-${n}`, exercise: ex, category: "flawless", emoji: "💎", tier: TIERS[i],
      title: `Flawless ${n}`, description: `A set of ${n} or more ${noun} with every rep clean and none cut short.`,
      key: `flawless:${ex}`, target: n,
    }));
  }
  defs.push(
    { id: "flawless-sets-10", category: "flawless", emoji: "✨", tier: "silver", title: "Perfectionist",
      description: "Finish 10 flawless sets.", key: "flawless", target: 10 },
    { id: "flawless-sets-50", category: "flawless", emoji: "🤖", tier: "gold", title: "Machine",
      description: "Finish 50 flawless sets.", key: "flawless", target: 50 },
  );
  for (const f of FIXES) {
    defs.push({
      id: `${f.exercise}-fix-${f.rule}`, exercise: f.exercise, category: "form", emoji: f.emoji, tier: "silver",
      title: f.title,
      description: `Fix ${f.what}: after a set where it showed up on half your reps or more, do a set of 5 or more without it.`,
      check: (c, s) => c.exercise === f.exercise && hasFixed(c, s, f.rule),
    });
  }
  defs.push(
    { id: "squat-below-parallel", exercise: "squat", category: "technique", emoji: "🎯", tier: "silver", title: "Below Parallel",
      description: "A set of 5 or more squats with a median knee angle of 90° or less at the bottom.",
      check: (c) => c.exercise === "squat" && c.reps >= 5 && c.depth !== null && c.depth <= 90 },
    { id: "pushup-chest-to-floor", exercise: "pushup", category: "technique", emoji: "🎯", tier: "silver", title: "Chest to Floor",
      description: "A set of 5 or more push-ups with a median elbow angle of 80° or less at the bottom.",
      check: (c) => c.exercise === "pushup" && c.reps >= 5 && c.depth !== null && c.depth <= 80 },
    { id: "controlled-1", category: "technique", emoji: "🐢", tier: "bronze", title: "Controlled",
      description: "A set of 5 or more reps taking 2–3 seconds on the way down, on average.", key: "controlled", target: 1 },
    { id: "controlled-10", category: "technique", emoji: "🧘", tier: "silver", title: "Slow and Steady",
      description: "Finish 10 controlled sets.", key: "controlled", target: 10 },
    { id: "form-streak", category: "technique", emoji: "✅", tier: "silver", title: "Form Streak",
      description: "5 sets in a row of the same exercise, each of 5 or more reps with at least 90% clean.", key: "formRun", target: 5 },
    { id: "glow-up", category: "technique", emoji: "🌟", tier: "gold", title: "Glow Up",
      description: "Raise your clean-rep rate by 20 points or more: your latest 5 sets of an exercise against your first 5.",
      check: (c, s) => {
        const p = s.cleanPcts[c.exercise];
        return p.length >= 10 && avg(p.slice(-5)) - avg(p.slice(0, 5)) >= 20;
      } },
  );
  [2, 4, 8, 12, 26, 52].forEach((n, i) => defs.push({
    id: `streak-${n}`, category: "consistency", emoji: "🔥", tier: TIERS[[0, 0, 1, 1, 2, 3][i]],
    title: `${n}-Week Streak`, description: `Train at least once a week for ${n} weeks in a row.`, key: "streak", target: n,
  }));
  [10, 50, 100, 250].forEach((n, i) => defs.push({
    id: `sets-${n}`, category: "consistency", emoji: "🏋️", tier: TIERS[i],
    title: `${n} Sets`, description: `Finish ${n} sets.`, key: "sets", target: n,
  }));
  defs.push(
    { id: "regular", category: "consistency", emoji: "🗓️", tier: "silver", title: "Regular",
      description: "Train on 12 different days in one calendar month.", key: "monthDays", target: 12 },
    { id: "big-day", category: "sessions", emoji: "⚡", tier: "silver", title: "Big Day",
      description: "Count 100 reps in one day.", key: "dayReps", target: 100 },
    { id: "big-week", category: "sessions", emoji: "📈", tier: "silver", title: "Big Week",
      description: "Count 300 reps in one week.", key: "weekReps", target: 300 },
    { id: "full-body", category: "sessions", emoji: "🤸", tier: "bronze", title: "Full Body",
      description: "Do squats and push-ups on the same day.", key: "dayExercises", target: 2 },
    { id: "all-rounder", category: "sessions", emoji: "🔄", tier: "silver", title: "All-Rounder",
      description: "Do both squats and push-ups in each of 4 weeks in a row.", key: "allRound", target: 4 },
    { id: "early-bird", category: "fun", emoji: "🌅", tier: "bronze", title: "Early Bird",
      description: "Start a set before 7 am.", check: (c) => c.started.getHours() < 7 },
    { id: "night-owl", category: "fun", emoji: "🦉", tier: "bronze", title: "Night Owl",
      description: "Start a set after 10 pm.", check: (c) => c.started.getHours() >= 22 },
    { id: "comeback", category: "fun", emoji: "👋", tier: "bronze", title: "Comeback",
      description: "Come back for a set after 30 days or more without one.", check: (c) => (c.gapDays ?? 0) >= 30 },
    { id: "even-hundred", category: "fun", emoji: "💯", tier: "gold", title: "Even Hundred", hidden: true,
      description: "A set of exactly 100 counted reps.", check: (c) => c.reps === 100 },
    { id: "new-year", category: "fun", emoji: "🎆", tier: "bronze", title: "New Year, New Reps", hidden: true,
      description: "Train on New Year's Day.", check: (c) => c.started.getMonth() === 0 && c.started.getDate() === 1 },
    { id: "double-ton", category: "fun", emoji: "🚀", tier: "gold", title: "Double Ton", hidden: true,
      description: "Do 200 clean reps in one day.", key: "dayClean", target: 200 },
  );
  return defs;
}

export const ACHIEVEMENTS: AchievementDef[] = buildDefs();
const BY_ID = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const prevWeek = (ms: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() - 7);
  return d.getTime();
};

function emptyStats(): Stats {
  return { n: {}, faulted: new Set(), cleanPcts: {}, days: new Map(), weeks: new Map(), months: new Map(), formRun: {} };
}

function record(s: Stats, c: SetCtx): void {
  const { set, exercise: ex } = c;
  const add = (key: string, v: number) => { s.n[key] = (s.n[key] ?? 0) + v; };
  const max = (key: string, v: number) => { s.n[key] = Math.max(s.n[key] ?? 0, v); };

  add(`reps:${ex}`, c.reps);
  add("sets", 1);
  max(`clean:${ex}`, c.clean);
  if (c.clean === c.reps && set.summary.partialReps === 0) {
    add("flawless", 1);
    max(`flawless:${ex}`, c.reps);
  }
  const down = set.summary.avgDownS;
  if (c.reps >= 5 && down !== null && down >= 2 && down <= 3) add("controlled", 1);

  const pct = (c.clean / c.reps) * 100;
  (s.cleanPcts[ex] ??= []).push(pct);
  if (c.reps >= 5) {
    s.formRun[ex] = pct >= 90 ? (s.formRun[ex] ?? 0) + 1 : 0;
    max("formRun", s.formRun[ex]);
  }
  for (const rule of set.config.rules) {
    if (set.reps.filter((r) => r.faults.includes(rule.id)).length * 2 >= set.reps.length) s.faulted.add(`${ex}:${rule.id}`);
  }

  const day = s.days.get(dayKey(c.started)) ?? { reps: 0, clean: 0, exercises: new Set<string>() };
  day.reps += c.reps;
  day.clean += c.clean;
  day.exercises.add(ex);
  s.days.set(dayKey(c.started), day);
  max("dayReps", day.reps);
  max("dayClean", day.clean);
  max("dayExercises", day.exercises.size);

  const week = weekStart(c.started).getTime();
  const weekExercises = s.weeks.get(week) ?? new Set<string>();
  weekExercises.add(ex);
  s.weeks.set(week, weekExercises);
  add(`weekReps@${week}`, c.reps);
  max("weekReps", s.n[`weekReps@${week}`]);
  let streak = 0;
  let allRound = 0;
  for (let w = week, both = true; s.weeks.has(w); w = prevWeek(w)) {
    streak++;
    both &&= Object.keys(EXERCISES).every((e) => s.weeks.get(w)!.has(e));
    if (both) allRound++;
  }
  max("streak", streak);
  max("allRound", allRound);

  const month = `${c.started.getFullYear()}-${c.started.getMonth()}`;
  const days = s.months.get(month) ?? new Set<string>();
  days.add(dayKey(c.started));
  s.months.set(month, days);
  max("monthDays", days.size);
}

function context(set: SetRecord, previous: Date | null): SetCtx {
  const started = new Date(set.summary.started);
  const bottoms = set.reps.filter((r) => r.counted && r.extremes[set.config.primaryMetric])
    .map((r) => r.extremes[set.config.primaryMetric][0]);
  return {
    set, exercise: set.summary.exercise, started, reps: set.summary.reps, clean: set.summary.cleanReps,
    depth: bottoms.length ? median(bottoms) : null,
    gapDays: previous ? (started.getTime() - previous.getTime()) / 86_400_000 : null,
  };
}

/** Replays sets oldest first. Sets with no counted reps don't count towards anything. */
export function replay(sets: SetRecord[]): { unlocked: Unlocks; stats: Stats } {
  const stats = emptyStats();
  const unlocked: Unlocks = {};
  let previous: Date | null = null;
  for (const set of [...sets].sort((a, b) => a.summary.started.localeCompare(b.summary.started))) {
    if (set.summary.reps === 0) continue;
    const c = context(set, previous);
    previous = c.started;
    record(stats, c);
    for (const def of ACHIEVEMENTS) {
      if (unlocked[def.id]) continue;
      if (def.check ? def.check(c, stats) : (stats.n[def.key!] ?? 0) >= def.target!) {
        unlocked[def.id] = { at: set.summary.started, setId: set.id };
      }
    }
  }
  return { unlocked, stats };
}

/** Both sets of unlocks; the earlier one wins when both have an achievement. Unknown ids are dropped. */
export function mergeUnlocks(a: Unlocks, b: Unlocks): Unlocks {
  const out: Unlocks = {};
  for (const [id, u] of [...Object.entries(a), ...Object.entries(b)]) {
    if (BY_ID.has(id) && (!out[id] || u.at < out[id].at)) out[id] = u;
  }
  return out;
}

export interface Progression {
  unlocked: Unlocks;
  stats: Stats;
  level: Level;
}

/** XP is earned by the sets still in history plus every achievement ever unlocked. */
export function progression(sets: SetRecord[], stored: Unlocks = {}): Progression {
  const { unlocked, stats } = replay(sets);
  const all = mergeUnlocks(stored, unlocked);
  const xp = sets.reduce((sum, s) => sum + setXp(s.summary), 0)
    + Object.keys(all).reduce((sum, id) => sum + TIER_XP[BY_ID.get(id)!.tier], 0);
  return { unlocked: all, stats, level: levelFor(xp) };
}

/** How far a counter achievement has got; null for one-off achievements. */
export function progressOf(def: AchievementDef, stats: Stats): { value: number; target: number } | null {
  if (!def.key) return null;
  return { value: Math.min(stats.n[def.key] ?? 0, def.target!), target: def.target! };
}

export interface SetProgress {
  xp: number;
  before: Level;
  after: Level;
  unlocked: AchievementDef[];
}

/** What `set` added, treating it as the newest set: XP, levels and newly unlocked achievements. */
export function setProgress(sets: SetRecord[], set: SetRecord, stored: Unlocks = {}): SetProgress {
  const others = sets.filter((s) => s.id !== set.id);
  // Unlocks this set already saved (the app saves them as soon as they're earned) still count as its own.
  const storedBefore = Object.fromEntries(Object.entries(stored).filter(([, u]) => u.setId !== set.id));
  const before = progression(others, storedBefore);
  const after = progression([...others, set], stored);
  return {
    xp: after.level.xp - before.level.xp,
    before: before.level,
    after: after.level,
    unlocked: ACHIEVEMENTS.filter((d) => after.unlocked[d.id] && !before.unlocked[d.id]),
  };
}
