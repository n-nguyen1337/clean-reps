// State machine and rule engine tests driven by synthetic metric streams
// (port of tests/test_exercise_engine.py).

import { describe, expect, it } from "vitest";
import { Exercise, forBody, isClean, parseConfig, type Body, type ExerciseUpdate, type Metrics, type Rule } from "../exercise";
import { EXERCISE_KEYS, createExercise } from "../exercises";
import { CueManager } from "../feedback";
import { Session } from "../session";

const FPS = 30;

const rule = (r: Partial<Rule> & Pick<Rule, "id" | "metric" | "cue">): Rule =>
  ({ priority: 1, min: null, max: null, aggregate: null, minFrames: 3, ...r });

function makeExercise(...rules: Rule[]) {
  return new Exercise<Metrics>("fake", {
    name: "Fake", primaryMetric: "angle", topThreshold: 160, bottomThreshold: 110,
    hysteresis: 8, minExcursion: 25, partialCue: "Go deeper", cameraHint: "", rules, proportions: {},
  }, ["angle", "lean"], (m) => m);
}

/** One smooth rep: high -> low -> high. */
function repCurve(low: number, high = 175, frames = 60): number[] {
  return Array.from({ length: frames }, (_, i) =>
    low + ((high - low) * (Math.cos((2 * Math.PI * i) / (frames - 1)) + 1)) / 2);
}

function run(ex: Exercise<Metrics>, angles: number[], lean?: number[], startT = 0): ExerciseUpdate[] {
  return angles.map((a, i) => ex.update({ angle: a, lean: lean ? lean[i] : null }, startT + i / FPS));
}

const completed = (us: ExerciseUpdate[]) => us.flatMap((u) => (u.completed ? [u.completed] : []));

describe("exercise engine", () => {
  it("counts full reps", () => {
    const ex = makeExercise();
    const reps = completed(run(ex, [...repCurve(90), ...repCurve(90), ...repCurve(90)]));
    expect(ex.reps).toBe(3);
    expect(reps.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(reps.every(isClean)).toBe(true);
    expect(ex.phase).toBe("top");
  });

  it("ignores jitter near the top threshold", () => {
    const ex = makeExercise();
    run(ex, Array.from({ length: 100 }, (_, i) => 160 + (i % 2 ? 3 : -3)));
    expect(ex.reps).toBe(0);
    expect(ex.phase).toBe("top");
  });

  it("reports partial reps without counting them", () => {
    const ex = makeExercise();
    const updates = run(ex, repCurve(125));
    const [rep] = completed(updates);
    expect(rep.counted).toBe(false);
    expect(rep.faults).toEqual(["partial"]);
    expect(updates.some((u) => u.cues.some((c) => c.id === "partial"))).toBe(true);
  });

  it("ignores small dips", () => {
    expect(completed(run(makeExercise(), repCurve(145)))).toEqual([]);
  });

  it("checks rep rules on the aggregate", () => {
    const ex = makeExercise(rule({ id: "depth", metric: "angle", aggregate: "min", max: 100, cue: "Deeper", priority: 3 }));
    const [shallow, deep] = completed(run(ex, [...repCurve(105), ...repCurve(90)]));
    expect(shallow.faults).toEqual(["depth"]);
    expect(isClean(deep)).toBe(true);
  });

  it("needs consecutive frames for live rules and cues once", () => {
    const ex = makeExercise(rule({ id: "lean", metric: "lean", max: 45, cue: "Chest up" }));
    const angles = repCurve(90);
    const leans = angles.map(() => 30);
    leans.fill(60, 20, 22); // 2 frames: below minFrames, ignored
    expect(isClean(completed(run(ex, angles, leans))[0])).toBe(true);

    leans.fill(60, 20, 30); // 10 frames: one fault, one cue
    const updates = run(ex, angles, leans, 10);
    expect(completed(updates)[0].faults).toEqual(["lean"]);
    expect(updates.flatMap((u) => u.cues).filter((c) => c.id === "lean")).toHaveLength(1);
  });

  it("cues for lost tracking, then aborts the rep", () => {
    const ex = makeExercise();
    run(ex, repCurve(90).slice(0, 30));
    expect(ex.phase).not.toBe("top");
    let last!: ExerciseUpdate;
    for (let i = 0; i < 90; i++) last = ex.update(null, 1 + i / FPS);
    expect(last.tracking).toBe(false);
    expect(last.cues.some((c) => c.id === "tracking")).toBe(true);
    expect(ex.phase).toBe("top");
  });

  it("rejects unknown metrics in the config", () => {
    expect(() => makeExercise(rule({ id: "x", metric: "nope", cue: "x", max: 1 }))).toThrow();
  });

  it.each(EXERCISE_KEYS)("loads the bundled %s rules", (key) => {
    expect(createExercise(key).config.rules.length).toBeGreaterThan(0);
  });
});

describe("body proportions", () => {
  const limits = (femur: Body["femur"], torso: Body["torso"]) => {
    const rules = createExercise("squat", { femur, torso }).config.rules;
    return [rules.find((r) => r.id === "torso_lean")!.max, rules.find((r) => r.id === "depth")!.max];
  };

  it("shifts the squat lean limit, leaving other rules alone", () => {
    expect(limits("average", "average")).toEqual([50, 100]);
    expect(limits("long", "short")).toEqual([65, 100]);
    expect(limits("short", "long")).toEqual([40, 100]);
    expect(limits("long", "long")).toEqual([53, 100]);
  });

  it("shifts both limits of a rule", () => {
    const cfg = { ...makeExercise(rule({ id: "lean", metric: "lean", cue: "x", min: 10, max: 40 })).config,
      proportions: { femur: { long: { lean: 5 } } } };
    const r = forBody(cfg, { femur: "long", torso: "average" }).rules[0];
    expect([r.min, r.max]).toEqual([15, 45]);
  });

  it("rejects proportions for unknown rules", () => {
    expect(() => parseConfig({
      name: "X", primary_metric: "a", top_threshold: 160, bottom_threshold: 100,
      proportions: { femur: { long: { nope: 5 } } },
    })).toThrow(/unknown rules/);
  });
});

describe("cue manager", () => {
  it("applies priority and cooldown", () => {
    const cm = new CueManager(2, 4);
    cm.push([{ id: "a", text: "A", priority: 1 }], 0);
    cm.push([{ id: "b", text: "B", priority: 0 }], 0.5); // lower priority waits
    expect(cm.current(0.5)?.id).toBe("a");
    cm.push([{ id: "c", text: "C", priority: 3 }], 1); // higher priority preempts
    expect(cm.current(1)?.id).toBe("c");
    expect(cm.current(3.5)).toBeNull(); // expired
    cm.push([{ id: "c", text: "C", priority: 3 }], 3.5); // still in cooldown
    expect(cm.current(3.5)).toBeNull();
    cm.push([{ id: "c", text: "C", priority: 3 }], 5.5);
    expect(cm.current(5.5)?.id).toBe("c");
  });
});

describe("session", () => {
  it("summarizes reps and faults", () => {
    const ex = makeExercise(rule({ id: "depth", metric: "angle", aggregate: "min", max: 100, cue: "Deeper" }));
    const session = new Session("fake");
    completed(run(ex, [...repCurve(90), ...repCurve(105), ...repCurve(125)])).forEach((r) => session.add(r));
    const s = session.summary();
    expect([s.reps, s.cleanReps, s.partialReps]).toEqual([2, 1, 1]);
    expect(s.faults).toEqual({ depth: 1, partial: 1 });
  });
});
