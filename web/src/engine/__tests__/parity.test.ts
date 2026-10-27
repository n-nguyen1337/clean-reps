// Parity with the Python engine. Fixtures come from tools/export_fixtures.py:
// raw landmarks per frame plus what the Python smoother, exercise and cue
// manager produced. The TS port must reproduce every frame.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExercise } from "../exercises";
import { CueManager } from "../feedback";
import { PoseFrame, PoseSmoother } from "../pose";

const DIR = join(__dirname, "../../../fixtures");
const FIXTURES = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
const TOL = 1e-6;

interface Fixture {
  exercise: string;
  frames: {
    t: number;
    ts: number;
    pose: { image: number[][]; world: number[][]; visibility: number[] } | null;
    expected: {
      phase: string; reps: number; tracking: boolean;
      metrics: Record<string, number | null>;
      cues: string[]; active_cue: string | null;
      completed: { counted: boolean; index: number | null; start_s: number; bottom_s: number;
        end_s: number; faults: string[]; extremes: Record<string, [number, number]> } | null;
    };
  }[];
}

const close = (a: number | null, b: number | null) =>
  a === null || b === null || Number.isNaN(a) ? (a === null || Number.isNaN(a)) && b === null : Math.abs(a - b) <= TOL;

describe.skipIf(!FIXTURES.length)("parity with Python", () => {
  it.each(FIXTURES)("%s", (name) => {
    const fx: Fixture = JSON.parse(readFileSync(join(DIR, name), "utf-8"));
    const ex = createExercise(fx.exercise);
    const smoother = new PoseSmoother();
    const cues = new CueManager();

    fx.frames.forEach((f, i) => {
      const raw = f.pose && PoseFrame.fromRows(f.pose.image, f.pose.world, f.pose.visibility, f.ts);
      const u = ex.update(smoother.apply(raw), f.t);
      cues.push(u.cues, f.t);
      const e = f.expected;
      const at = `frame ${i}`;

      expect({ phase: u.phase, reps: u.reps, tracking: u.tracking }, at)
        .toEqual({ phase: e.phase, reps: e.reps, tracking: e.tracking });
      for (const [k, v] of Object.entries(e.metrics)) {
        expect(close(u.metrics[k] ?? null, v), `${at} ${k}: ${u.metrics[k]} vs ${v}`).toBe(true);
      }
      expect(u.cues.map((c) => c.id), at).toEqual(e.cues);
      expect(cues.current(f.t)?.id ?? null, at).toBe(e.active_cue);

      const c = u.completed;
      expect(c === null, at).toBe(e.completed === null);
      if (c && e.completed) {
        expect({ counted: c.counted, index: c.index, faults: c.faults }, at)
          .toEqual({ counted: e.completed.counted, index: e.completed.index, faults: e.completed.faults });
        expect([c.startS, c.bottomS, c.endS]).toEqual([e.completed.start_s, e.completed.bottom_s, e.completed.end_s]);
        for (const [k, [lo, hi]] of Object.entries(e.completed.extremes)) {
          expect(close(c.extremes[k][0], lo) && close(c.extremes[k][1], hi), `${at} extremes ${k}`).toBe(true);
        }
      }
    });
  });
});
