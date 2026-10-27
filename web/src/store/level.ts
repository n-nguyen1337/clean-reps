// XP and levels. Clean reps earn most of the XP, so leveling up rewards form,
// not just volume. All the tuning constants live here.

import type { SessionSummary } from "../engine/session";

export type Tier = "bronze" | "silver" | "gold" | "platinum";

export const TIER_XP: Record<Tier, number> = { bronze: 25, silver: 50, gold: 100, platinum: 250 };

const XP_CLEAN_REP = 10;
const XP_FAULTY_REP = 3;
const XP_SET = 15;

/** Every 5 levels is a named rank. */
export const RANKS = ["Rookie", "Trainee", "Regular", "Athlete", "Iron", "Steel", "Elite", "Master", "Legend"] as const;

export interface Level {
  level: number;
  rank: string;
  xp: number;
  /** Total XP at the start of this level and at the start of the next. */
  levelXp: number;
  nextXp: number;
}

/** Partial reps earn nothing; a set with no counted reps earns nothing. */
export function setXp(s: SessionSummary): number {
  if (s.reps === 0) return 0;
  return XP_CLEAN_REP * s.cleanReps + XP_FAULTY_REP * (s.reps - s.cleanReps) + XP_SET;
}

/** Total XP needed to reach `level` (level 1 is 0). */
export function xpForLevel(level: number): number {
  const n = level - 1;
  return 50 * n * n + 100 * n;
}

export const rankFor = (level: number): string => RANKS[Math.min(RANKS.length - 1, Math.floor(level / 5))];

export function levelFor(xp: number): Level {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, rank: rankFor(level), xp, levelXp: xpForLevel(level), nextXp: xpForLevel(level + 1) };
}
