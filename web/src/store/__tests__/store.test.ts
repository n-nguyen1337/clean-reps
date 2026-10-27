import { beforeEach, describe, expect, it } from "vitest";
import { sync, forgetSyncedSets, type Remote } from "../../cloud/sync";
import { fromRow, toRow } from "../../cloud/remote";
import type { ExerciseConfig, RepResult } from "../../engine/exercise";
import { activeSets, db, deleteSet, getMeta, saveSet } from "../db";
import { bestSet, previousSet, setPoints, weeklyTotals, weekStart, weekStreak } from "../progress";
import { toSessionRecord, toSetRecord, type SetRecord } from "../record";

const config: ExerciseConfig = {
  name: "Squat", primaryMetric: "knee_angle", topThreshold: 160, bottomThreshold: 120,
  hysteresis: 8, minExcursion: 25, partialCue: "Go deeper", cameraHint: "", proportions: {},
  rules: [{ id: "depth", metric: "knee_angle", aggregate: "min", max: 100, min: null, cue: "Squat a little deeper", priority: 1, minFrames: 3 }],
};

function rep(i: number, bottom: number, faults: string[] = []): RepResult {
  return { counted: true, index: i + 1, startS: i * 3 + 0.123, bottomS: i * 3 + 1.456, endS: i * 3 + 2.789, faults,
    extremes: { knee_angle: [bottom + 0.0042, 175.3333] } };
}

let n = 0;
function makeSet(started: string, bottoms: number[], opts: { faulted?: number; exercise?: string } = {}): SetRecord {
  const reps = bottoms.map((b, i) => rep(i, b, i < (opts.faulted ?? 0) ? ["depth"] : []));
  const clean = reps.filter((r) => !r.faults.length).length;
  return toSetRecord({
    summary: { exercise: opts.exercise ?? "squat", started: new Date(started).toISOString(), reps: reps.length, cleanReps: clean, partialReps: 0,
      faults: opts.faulted ? { depth: opts.faulted } : {}, avgDownS: 1.33, avgUpS: 1.33 },
    reps, trace: [{ t: 10, metrics: {} }, { t: 25.5, metrics: {} }], config, body: { femur: "average", torso: "average" },
  }, new Date("2026-10-27T12:00:00Z"), `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
}

beforeEach(async () => {
  await db.sets.clear();
  await db.meta.clear();
});

describe("toSetRecord", () => {
  it("drops the trace, keeps duration, and rounds rep timings and extremes", () => {
    const set = makeSet("2026-10-20T09:00:00.000Z", [95]);
    expect(set.durationS).toBe(15.5);
    expect(set.reps[0]).toMatchObject({ startS: 0.12, bottomS: 1.46, endS: 2.79, extremes: { knee_angle: [95, 175.33] } });
    expect(set.syncedAt).toBeNull();
    expect(toSessionRecord(set).trace).toEqual([]);
  });
});

describe("progress", () => {
  const sets = [
    makeSet("2026-10-26T18:00:00", [100, 90, 110], { faulted: 1 }), // Monday, this week
    makeSet("2026-10-21T18:00:00", [105, 95]),
    makeSet("2026-10-14T18:00:00", [120, 118, 116, 112], { faulted: 2 }),
    makeSet("2026-09-30T18:00:00", [100], { exercise: "pushup" }),
  ];
  const now = new Date("2026-10-27T12:00:00");

  it("starts weeks on Monday", () => {
    expect(weekStart(new Date("2026-10-26T23:59:00")).getDate()).toBe(26);
    expect(weekStart(new Date("2026-11-01T10:00:00")).getDate()).toBe(26); // Sunday
  });

  it("builds per-set points oldest first, with median depth and clean %", () => {
    const pts = setPoints(sets.filter((s) => s.summary.exercise === "squat"));
    expect(pts.map((p) => p.cleanPct)).toEqual([50, 100, 67]);
    expect(pts.map((p) => p.depth)).toEqual([117, 100, 100]);
  });

  it("totals reps per week including empty weeks", () => {
    const weeks = weeklyTotals(sets, now, 5);
    expect(weeks.map((w) => [w.start.getDate(), w.reps, w.sets])).toEqual([[28, 1, 1], [5, 0, 0], [12, 4, 1], [19, 2, 1], [26, 3, 1]]);
  });

  it("counts a streak of consecutive training weeks", () => {
    expect(weekStreak(sets, now)).toBe(3);
    expect(weekStreak(sets, new Date("2026-11-03T12:00:00"))).toBe(3); // nothing yet this week: count from last week
    expect(weekStreak(sets, new Date("2026-11-12T12:00:00"))).toBe(0);
  });

  it("finds the best and the previous set of the same exercise", () => {
    expect(bestSet(sets)?.id).toBe(sets[2].id); // 2 clean, earliest of the ties
    expect(previousSet(sets, sets[0])?.id).toBe(sets[1].id);
    expect(previousSet(sets, sets[3])).toBeNull();
  });
});

describe("db", () => {
  it("lists live sets newest first and soft-deletes", async () => {
    const [a, b] = [makeSet("2026-10-20T09:00:00Z", [95]), makeSet("2026-10-22T09:00:00Z", [95])];
    await saveSet(a);
    await saveSet(b);
    expect((await activeSets()).map((s) => s.id)).toEqual([b.id, a.id]);
    await deleteSet(a.id, new Date("2026-10-27T13:00:00Z"));
    expect((await activeSets()).map((s) => s.id)).toEqual([b.id]);
    expect((await db.sets.get(a.id))?.updatedAt).toBe("2026-10-27T13:00:00.000Z");
  });
});

/** An in-memory server that stamps updated_at like the database trigger. */
function fakeRemote() {
  const rows = new Map<string, SetRecord>();
  let clock = Date.parse("2026-10-27T15:00:00Z");
  const pushes: string[][] = [];
  const remote: Remote = {
    async push(sets) {
      pushes.push(sets.map((s) => s.id));
      for (const s of sets) {
        const stamped = new Date(clock++).toISOString();
        rows.set(s.id, { ...fromRow({ ...toRow(s), updated_at: stamped }) });
      }
    },
    async pull(since) {
      const out = [...rows.values()].filter((r) => !since || r.updatedAt >= since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      return { sets: out, cursor: out.length ? out[out.length - 1].updatedAt : since };
    },
  };
  return { remote, rows, pushes, serverAdd: (s: SetRecord) => remote.push([s]) };
}

describe("sync", () => {
  it("pushes local sets once, marks them synced, and is idempotent", async () => {
    const { remote, rows, pushes } = fakeRemote();
    const set = makeSet("2026-10-20T09:00:00Z", [95]);
    await saveSet(set);

    expect(await sync(remote)).toMatchObject({ pushed: 1 });
    expect(rows.get(set.id)?.summary).toEqual(set.summary);
    const local = await db.sets.get(set.id);
    expect(local?.syncedAt).not.toBeNull();
    expect(local?.syncedAt).toBe(local?.updatedAt);
    expect(await getMeta("pullCursor")).not.toBeNull();

    expect(await sync(remote)).toMatchObject({ pushed: 0 });
    expect(pushes).toHaveLength(1);
  });

  it("pulls sets from another device and propagates deletes both ways", async () => {
    const { remote, rows, serverAdd } = fakeRemote();
    const other = makeSet("2026-10-21T09:00:00Z", [97]);
    await serverAdd(other);
    await sync(remote);
    expect((await activeSets()).map((s) => s.id)).toEqual([other.id]);

    await deleteSet(other.id);
    await sync(remote);
    expect(rows.get(other.id)?.deletedAt).not.toBeNull();

    const third = makeSet("2026-10-22T09:00:00Z", [97]);
    await serverAdd(third);
    await serverAdd({ ...third, deletedAt: "2026-10-27T16:00:00.000Z" });
    await sync(remote);
    expect(await activeSets()).toEqual([]);
  });

  it("keeps a local delete when a stale server copy arrives", async () => {
    const { remote, serverAdd } = fakeRemote();
    const set = makeSet("2026-10-21T09:00:00Z", [97]);
    await serverAdd(set);
    await sync(remote);
    await deleteSet(set.id);
    // Pull only: simulate the push failing by syncing against a remote that rejects pushes.
    await expect(sync({ ...remote, push: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect((await db.sets.get(set.id))?.deletedAt).not.toBeNull();
    await sync(remote);
    expect(await activeSets()).toEqual([]);
  });

  it("forgets synced sets on sign-out but keeps unsynced ones", async () => {
    const { remote } = fakeRemote();
    const synced = makeSet("2026-10-20T09:00:00Z", [95]);
    await saveSet(synced);
    await sync(remote);
    const pending = makeSet("2026-10-21T09:00:00Z", [95]);
    await saveSet(pending);

    await forgetSyncedSets();
    expect((await db.sets.toArray()).map((s) => s.id)).toEqual([pending.id]);
    expect(await getMeta("pullCursor")).toBeNull();
  });
});
