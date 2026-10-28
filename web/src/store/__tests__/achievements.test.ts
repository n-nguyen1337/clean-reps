import { beforeEach, describe, expect, it } from "vitest";
import { forgetSyncedSets } from "../../cloud/sync";
import type { ExerciseConfig, RepResult } from "../../engine/exercise";
import { ACHIEVEMENTS, progression, replay, setProgress } from "../achievements";
import { db, saveSet, saveUnlocks } from "../db";
import { levelFor, setXp, xpForLevel } from "../level";
import { toSetRecord, type SetRecord } from "../record";

const config: ExerciseConfig = {
  name: "Squat", primaryMetric: "knee_angle", topThreshold: 160, bottomThreshold: 120,
  hysteresis: 8, minExcursion: 25, readyS: 1, topMargin: null, topFloor: null, partialCue: "Go deeper", cameraHint: "", proportions: {},
  rules: [
    { id: "depth", metric: "knee_angle", aggregate: "min", max: 100, min: null, cue: "Squat a little deeper", priority: 3, minFrames: 3, noRep: false },
    { id: "torso_lean", metric: "torso_lean", aggregate: "max", max: 50, min: null, cue: "Chest up", priority: 2, minFrames: 3, noRep: false },
  ],
};

interface Opts { faults?: string[][]; bottom?: number; side?: boolean; downS?: number; exercise?: string }

let n = 0;
function makeSet(started: string, reps: number, opts: Opts = {}): SetRecord {
  const results: RepResult[] = Array.from({ length: reps }, (_, i) => ({
    counted: true, index: i + 1, startS: i * 3, bottomS: i * 3 + 1, endS: i * 3 + 2, faults: opts.faults?.[i] ?? [],
    extremes: { knee_angle: [opts.bottom ?? 95, 175], ...(opts.side ? { torso_lean: [10, 30] as [number, number] } : {}) },
  }));
  const clean = results.filter((r) => !r.faults.length).length;
  const faults: Record<string, number> = {};
  for (const r of results) for (const f of r.faults) faults[f] = (faults[f] ?? 0) + 1;
  return toSetRecord({
    summary: { exercise: opts.exercise ?? "squat", started: new Date(started).toISOString(), reps, cleanReps: clean, partialReps: 0,
      faults, avgDownS: opts.downS ?? 1, avgUpS: 1 },
    reps: results, trace: [], config, body: { femur: "average", torso: "average" },
  }, new Date("2026-10-27T12:00:00Z"), `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
}

const ids = (sets: SetRecord[]) => Object.keys(replay(sets).unlocked);

beforeEach(async () => {
  await db.sets.clear();
  await db.meta.clear();
});

describe("levels", () => {
  it("follows the curve and names a rank every 5 levels", () => {
    expect([1, 2, 5, 10, 20].map(xpForLevel)).toEqual([0, 150, 1200, 4950, 19950]);
    expect(levelFor(149)).toMatchObject({ level: 1, rank: "Rookie", levelXp: 0, nextXp: 150 });
    expect(levelFor(150).level).toBe(2);
    expect(levelFor(1200)).toMatchObject({ level: 5, rank: "Trainee" });
    expect(levelFor(10_000_000).rank).toBe("Legend");
  });

  it("pays most for clean reps and nothing for a set with no counted reps", () => {
    expect(setXp(makeSet("2026-10-01T18:00", 10, { faults: [["depth"], ["depth"]] }).summary)).toBe(80 + 6 + 15);
    expect(setXp(makeSet("2026-10-01T18:00", 0).summary)).toBe(0);
  });
});

describe("achievements", () => {
  it("has unique ids, 59 visible and 3 hidden", () => {
    expect(new Set(ACHIEVEMENTS.map((d) => d.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.filter((d) => !d.hidden)).toHaveLength(59);
    expect(ACHIEVEMENTS.filter((d) => d.hidden)).toHaveLength(3);
  });

  it("unlocks at the first set that crosses the threshold", () => {
    const sets = [makeSet("2026-10-01T18:00", 60), makeSet("2026-10-03T18:00", 50)];
    const { unlocked, stats } = replay(sets);
    expect(unlocked["squat-reps-1"]).toEqual({ at: sets[0].summary.started, setId: sets[0].id });
    expect(unlocked["squat-reps-100"].setId).toBe(sets[1].id);
    expect(unlocked["squat-set-50"].setId).toBe(sets[0].id);
    expect(stats.n["reps:squat"]).toBe(110);
    expect(unlocked["pushup-reps-1"]).toBeUndefined();
  });

  it("counts a flawless set only when every rep is clean", () => {
    expect(ids([makeSet("2026-10-01T18:00", 5, { faults: [["depth"]] })])).not.toContain("squat-flawless-5");
    expect(ids([makeSet("2026-10-01T18:00", 5)])).toContain("squat-flawless-5");
  });

  it("needs the fault first, then a set of 5+ without it", () => {
    const faulty = makeSet("2026-10-02T18:00", 4, { faults: [["depth"], ["depth"], [], []] });
    expect(ids([makeSet("2026-10-01T18:00", 5), faulty])).not.toContain("squat-fix-depth");
    expect(ids([faulty, makeSet("2026-10-03T18:00", 5)])).toContain("squat-fix-depth");
  });

  it("only counts a view-dependent fix when the set was filmed from that view", () => {
    const leaning = makeSet("2026-10-02T18:00", 4, { side: true, faults: [["torso_lean"], ["torso_lean"]] });
    expect(ids([leaning, makeSet("2026-10-03T18:00", 5)])).not.toContain("squat-fix-torso_lean");
    expect(ids([leaning, makeSet("2026-10-03T18:00", 5, { side: true })])).toContain("squat-fix-torso_lean");
  });

  it("tracks depth, tempo, streaks and mixed days", () => {
    const sets = [
      makeSet("2026-10-05T06:30", 5, { bottom: 88, downS: 2.5 }), // Monday, early
      makeSet("2026-10-05T19:00", 5, { exercise: "pushup", bottom: 120 }),
      makeSet("2026-10-12T18:00", 5),
    ];
    const got = ids(sets);
    expect(got).toEqual(expect.arrayContaining(["squat-below-parallel", "controlled-1", "early-bird", "full-body", "streak-2"]));
    expect(got).not.toContain("pushup-chest-to-floor");
    expect(got).not.toContain("all-rounder");
  });

  it("spots a comeback after 30 days off", () => {
    expect(ids([makeSet("2026-08-01T18:00", 5), makeSet("2026-09-05T18:00", 5)])).toContain("comeback");
    expect(ids([makeSet("2026-08-01T18:00", 5), makeSet("2026-08-20T18:00", 5)])).not.toContain("comeback");
  });
});

describe("progression", () => {
  it("adds achievement XP to set XP", () => {
    const set = makeSet("2026-10-01T18:00", 5);
    const p = progression([set]);
    const tierXp = { bronze: 25, silver: 50, gold: 100, platinum: 250 };
    const achXp = ACHIEVEMENTS.filter((d) => p.unlocked[d.id]).reduce((s, d) => s + tierXp[d.tier], 0);
    expect(p.level.xp).toBe(setXp(set.summary) + achXp);
  });

  it("keeps stored unlocks after the set that earned them is gone", () => {
    const set = makeSet("2026-10-01T18:00", 5);
    const p = progression([], replay([set]).unlocked);
    expect(p.unlocked["squat-flawless-5"].setId).toBe(set.id);
    expect(p.level.xp).toBeGreaterThan(0);
  });

  it("reports what the newest set added, even after its unlocks are stored", () => {
    const first = makeSet("2026-10-01T18:00", 5);
    const second = makeSet("2026-10-02T18:00", 10);
    const stored = replay([first, second]).unlocked;
    for (const s of [{}, stored]) {
      const got = setProgress([first, second], second, s);
      expect(got.unlocked.map((d) => d.id)).toEqual(expect.arrayContaining(["squat-set-10", "squat-flawless-10"]));
      expect(got.unlocked.map((d) => d.id)).not.toContain("squat-reps-1");
      expect(got.xp).toBe(got.after.xp - got.before.xp);
    }
  });

  it("doesn't count a stored unlock from a deleted set as new", () => {
    const deleted = makeSet("2026-10-01T18:00", 10);
    const stored = replay([deleted]).unlocked;
    const again = makeSet("2026-10-05T18:00", 10);
    expect(setProgress([again], again, stored).unlocked.map((d) => d.id)).not.toContain("squat-set-10");
  });
});

describe("stored unlocks", () => {
  it("merges with the earlier unlock winning and drops a signed-out account's unlocks", async () => {
    const synced = makeSet("2026-10-01T18:00", 5);
    const local = makeSet("2026-10-02T18:00", 5, { exercise: "pushup" });
    await saveSet({ ...synced, syncedAt: synced.updatedAt });
    await saveSet(local);
    await saveUnlocks(replay([local]).unlocked);
    await saveUnlocks({ "squat-reps-1": { at: synced.summary.started, setId: synced.id } });
    await saveUnlocks({ "squat-reps-1": { at: "2027-01-01T00:00:00.000Z", setId: "later" } });
    const read = async () => JSON.parse((await db.meta.get("achievements"))!.value);
    expect((await read())["squat-reps-1"].setId).toBe(synced.id);

    await forgetSyncedSets();
    const kept = await read();
    expect(kept["squat-reps-1"]).toBeUndefined();
    expect(kept["pushup-reps-1"].setId).toBe(local.id);
  });
});
