import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVERAGE_BODY, type RepResult } from "../../engine/exercise";
import { createExercise } from "../../engine/exercises";
import { PoseFrame, PoseSmoother } from "../../engine/pose";
import { clipName, LandmarkLog, labEnabled, labExport, labFiles } from "../lab";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

const pose = (v: number) => new PoseFrame(new Float64Array(99).fill(v), new Float64Array(99).fill(v / 10),
  new Float64Array(33).fill(0.9), 0);

describe("labEnabled", () => {
  it("turns on with ?lab=1 and stays on until ?lab=0", () => {
    expect(labEnabled("")).toBe(false);
    expect(labEnabled("?lab=1")).toBe(true);
    expect(labEnabled("")).toBe(true);
    expect(labEnabled("?lab=0")).toBe(false);
    expect(labEnabled("")).toBe(false);
  });
});

describe("LandmarkLog", () => {
  it("stops at the cap and keeps gaps", () => {
    const log = new LandmarkLog("lite", 1);
    log.push(0, 0, pose(1), 720, 1280);
    log.push(0.5, 500, null, 720, 1280);
    log.push(1.5, 1500, pose(2), 720, 1280);
    expect(log.frames.map((f) => f.t)).toEqual([0, 0.5]);
    expect([log.width, log.height]).toEqual([720, 1280]);
  });
});

describe("labExport", () => {
  const rep: RepResult = { counted: true, index: 1, startS: 1, bottomS: 1.23456789, endS: 2, faults: ["depth"],
    extremes: { knee_angle: [95, 170] } };

  it("writes fixture-shaped frames and draft labels", () => {
    const log = new LandmarkLog("lite", 60);
    log.push(0.1, 100, pose(1.23456789), 720, 1280);
    log.push(0.2, 200, null, 720, 1280);
    const out = labExport({ exercise: "squat", body: AVERAGE_BODY, reps: [rep], log, recording: null, videoFile: null });

    expect(out.frames[0].pose!.image).toHaveLength(33);
    expect(out.frames[0].pose!.image[0]).toEqual([1.234568, 1.234568, 1.234568]);
    expect(out.frames[1]).toEqual({ t: 0.2, ts: 200, pose: null });
    expect(out.labels).toEqual({ draft: true, exercise: "squat", person: null, split: null,
      reps: [{ bottom_s: 1.234568, counted: true, faults: ["depth"] }] });
    expect(out.video).toBeNull();
    expect(out.model).toBe("lite");
  });

  it("names the video and puts it first", () => {
    const log = new LandmarkLog("full", 60);
    log.push(0, 0, pose(1), 1280, 720);
    const recording = { video: new Blob(["x"], { type: "video/mp4" }), mimeType: "video/mp4", offsetS: 0.1, endS: 9 };
    const now = new Date(2026, 9, 28, 14, 30, 5);
    const files = labFiles({ exercise: "pushup", body: AVERAGE_BODY, reps: [], log, recording, now });
    expect(files.map((f) => f.name)).toEqual(["20261028-143005-pushup.mp4", "20261028-143005-pushup.lab.json"]);
    expect(clipName("squat", now)).toBe("20261028-143005-squat");
  });
});

// An export replayed through the engine must reproduce the reps seen live, so the
// Python tools and parity tests can use phone clips as fixtures.
const DIR = join(__dirname, "../../../fixtures");
const FIXTURE = existsSync(DIR) ? readdirSync(DIR).find((f) => f.endsWith(".squat.json")) : undefined;

describe.skipIf(!FIXTURE)("export round trip", () => {
  it("replays to the same reps", () => {
    const fx = JSON.parse(readFileSync(join(DIR, FIXTURE!), "utf-8"));
    const run = (frames: { t: number; ts: number; pose: { image: number[][]; world: number[][]; visibility: number[] } | null }[]) => {
      const ex = createExercise("squat");
      const smoother = new PoseSmoother();
      const reps: RepResult[] = [];
      for (const f of frames) {
        const raw = f.pose && PoseFrame.fromRows(f.pose.image, f.pose.world, f.pose.visibility, f.ts);
        const u = ex.update(smoother.apply(raw), f.t);
        if (u.completed) reps.push(u.completed);
      }
      return reps;
    };

    const log = new LandmarkLog("full", Infinity);
    for (const f of fx.frames) {
      log.push(f.t, f.ts, f.pose && PoseFrame.fromRows(f.pose.image, f.pose.world, f.pose.visibility, f.ts), 1, 1);
    }
    const live = run(fx.frames);
    const out = labExport({ exercise: "squat", body: AVERAGE_BODY, reps: live, log, recording: null, videoFile: null });
    const replayed = run(JSON.parse(JSON.stringify(out)).frames);
    expect(replayed.map((r) => [r.counted, r.faults])).toEqual(live.map((r) => [r.counted, r.faults]));
    expect(live.length).toBeGreaterThan(0);
  });
});
