// Dev-only sample history, so the Progress, Achievements and set pages can be
// tried without a camera. Seeded sets are tagged by appVersion and marked as
// synced, so they never upload to the account.

import { AVERAGE_BODY, type RepResult, type Rule } from "../engine/exercise";
import { EXERCISE_KEYS, createExercise } from "../engine/exercises";
import { db, keepUnlocksOf } from "../store/db";
import { toSetRecord, type SetRecord } from "../store/record";

const SEED_VERSION = "dev-seed";
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A metric value just inside the rule's limits, or past them when faulted. */
function ruleValue(rule: Rule, faulted: boolean): number {
  if (rule.max !== null) return faulted ? rule.max + rand(3, 15) : rule.max - rand(3, 25);
  if (rule.min !== null) return faulted ? rule.min - rand(3, 15) : rule.min + rand(3, 25);
  return rand(0, 90);
}

function makeSet(exercise: string, started: Date, skill: number): SetRecord {
  const config = createExercise(exercise).config;
  const faultChance = 0.45 * (1 - skill) + 0.05;
  const reps: RepResult[] = [];
  let t = rand(1, 3);
  for (let i = 0; i < Math.round(rand(5, 15)); i++) {
    const faults = config.rules.filter(() => Math.random() < faultChance / config.rules.length * 2)
      .slice(0, 2).map((r) => r.id);
    const counted = !config.rules.some((r) => r.noRep && faults.includes(r.id));
    const extremes: Record<string, [number, number]> = {
      [config.primaryMetric]: [config.bottomThreshold - rand(5, 10 + 20 * skill), config.topThreshold + rand(0, 5)],
    };
    for (const rule of config.rules) {
      if (rule.metric === config.primaryMetric) continue;
      const v = ruleValue(rule, faults.includes(rule.id));
      extremes[rule.metric] = rule.aggregate === "min" || rule.min !== null ? [v, v + rand(10, 30)] : [v - rand(10, 30), v];
    }
    const down = rand(1.2, 1.6 + 1.4 * skill);
    const up = rand(0.8, 1.4);
    reps.push({ counted, index: null, startS: t, bottomS: t + down, endS: t + down + up, faults, extremes });
    t += down + up + rand(0.3, 1);
  }
  reps.filter((r) => r.counted).forEach((r, i) => (r.index = i + 1));

  const counted = reps.filter((r) => r.counted);
  const faults: Record<string, number> = {};
  for (const r of reps) for (const f of r.faults) faults[f] = (faults[f] ?? 0) + 1;
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const set = toSetRecord({
    summary: {
      exercise, started: started.toISOString(), reps: counted.length,
      cleanReps: counted.filter((r) => !r.faults.length).length, partialReps: reps.length - counted.length, faults,
      avgDownS: avg(counted.map((r) => r.bottomS - r.startS)), avgUpS: avg(counted.map((r) => r.endS - r.bottomS)),
    },
    reps, trace: [{ t: 0, metrics: {} }, { t: t + 1, metrics: {} }], config, body: AVERAGE_BODY,
  }, started);
  return { ...set, appVersion: SEED_VERSION, syncedAt: set.updatedAt };
}

/** About eight weeks of sets, mostly the first exercise, with form improving over time. */
export async function seedSampleSets(weeks = 8): Promise<number> {
  const sets: SetRecord[] = [];
  const now = Date.now();
  const days = weeks * 7;
  for (let d = days; d >= 0; d--) {
    if (Math.random() > 0.45) continue;
    const started = new Date(now - d * 86_400_000);
    started.setHours(Math.round(rand(7, 20)), Math.round(rand(0, 59)), 0, 0);
    if (started.getTime() > now) started.setTime(now - 3_600_000);
    const exercise = Math.random() < 0.65 ? EXERCISE_KEYS[0] : EXERCISE_KEYS[1 + Math.floor(Math.random() * (EXERCISE_KEYS.length - 1))] ?? EXERCISE_KEYS[0];
    sets.push(makeSet(exercise, started, 1 - d / days));
  }
  await db.sets.bulkPut(sets);
  return sets.length;
}

/** Removes the seeded sets and the achievements they earned. */
export async function clearSampleSets(): Promise<number> {
  return db.transaction("rw", db.sets, db.meta, async () => {
    const ids = await db.sets.filter((s) => s.appVersion === SEED_VERSION).primaryKeys();
    await db.sets.bulkDelete(ids);
    await keepUnlocksOf(new Set(await db.sets.toCollection().primaryKeys()));
    return ids.length;
  });
}
