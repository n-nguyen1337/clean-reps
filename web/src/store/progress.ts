// Progress over many sets of one exercise, computed from on-device history.

import { analyze } from "../engine/analysis";
import type { SetRecord } from "./record";

export interface SetPoint {
  id: string;
  started: Date;
  reps: number;
  /** Clean reps as a percentage of counted reps; null for a set with no counted reps. */
  cleanPct: number | null;
  /** Median bottom of the primary metric over counted reps (lower is a fuller rep). */
  depth: number | null;
  avgDownS: number | null;
}

export interface WeekTotal {
  start: Date;
  reps: number;
  sets: number;
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Monday 00:00 local time of the week containing `d`. */
export function weekStart(d: Date): Date {
  const w = new Date(d);
  w.setHours(0, 0, 0, 0);
  w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
  return w;
}

/** One point per set, oldest first. */
export function setPoints(sets: SetRecord[]): SetPoint[] {
  return [...sets]
    .sort((a, b) => a.summary.started.localeCompare(b.summary.started))
    .map((set) => {
      const { summary: s } = set;
      const bottoms = analyze(set.config, set.reps).rows
        .filter((r) => r.rep.counted && r.bottom !== null).map((r) => r.bottom!);
      return {
        id: set.id,
        started: new Date(s.started),
        reps: s.reps,
        cleanPct: s.reps ? Math.round((s.cleanReps / s.reps) * 100) : null,
        depth: bottoms.length ? median(bottoms) : null,
        avgDownS: s.avgDownS,
      };
    });
}

/** Counted reps and sets per week for the last `weeks` weeks, oldest first, including empty weeks. */
export function weeklyTotals(sets: SetRecord[], now: Date, weeks = 8): WeekTotal[] {
  const current = weekStart(now);
  const out: WeekTotal[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * i);
    out.push({ start, reps: 0, sets: 0 });
  }
  for (const set of sets) {
    const t = weekStart(new Date(set.summary.started)).getTime();
    const week = out.find((w) => w.start.getTime() === t);
    if (week) {
      week.reps += set.summary.reps;
      week.sets += 1;
    }
  }
  return out;
}

/** Consecutive weeks with at least one set, ending this week (or last week, if none yet this week). */
export function weekStreak(sets: SetRecord[], now: Date): number {
  const trained = new Set(sets.map((s) => weekStart(new Date(s.summary.started)).getTime()));
  const week = weekStart(now);
  if (!trained.has(week.getTime())) week.setDate(week.getDate() - 7);
  let streak = 0;
  while (trained.has(week.getTime())) {
    streak++;
    week.setDate(week.getDate() - 7);
  }
  return streak;
}

/** The set with the most clean reps; the earliest one wins a tie. */
export function bestSet(sets: SetRecord[]): SetRecord | null {
  let best: SetRecord | null = null;
  for (const s of sets) {
    if (s.summary.cleanReps === 0) continue;
    if (!best || s.summary.cleanReps > best.summary.cleanReps
      || (s.summary.cleanReps === best.summary.cleanReps && s.summary.started < best.summary.started)) best = s;
  }
  return best;
}

/** The latest set of the same exercise started before `set`. */
export function previousSet(sets: SetRecord[], set: SetRecord): SetRecord | null {
  let prev: SetRecord | null = null;
  for (const s of sets) {
    if (s.id === set.id || s.summary.exercise !== set.summary.exercise || s.summary.started >= set.summary.started) continue;
    if (!prev || s.summary.started > prev.summary.started) prev = s;
  }
  return prev;
}
