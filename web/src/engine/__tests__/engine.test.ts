// State machine and rule engine tests driven by synthetic metric streams
// (port of tests/test_exercise_engine.py).

import { describe, expect, it } from "vitest";
import { Exercise, forBody, isClean, parseConfig, quantile, type Body, type ExerciseConfig, type ExerciseUpdate, type Metrics, type Rule } from "../exercise";
import { EXERCISE_KEYS, createExercise } from "../exercises";
import { CueManager } from "../feedback";
import { Session } from "../session";

const FPS = 30;

const rule = (r: Partial<Rule> & Pick<Rule, "id" | "metric" | "cue">): Rule =>
  ({ priority: 1, min: null, max: null, aggregate: null, minFrames: 3, noRep: false, ...r });

function makeExercise(...rules: Rule[]) {
  return configuredExercise({}, ...rules);
}

function configuredExercise(options: Partial<ExerciseConfig>, ...rules: Rule[]) {
  return new Exercise<Metrics>("fake", {
    name: "Fake", primaryMetric: "angle", topThreshold: 160, bottomThreshold: 110,
    hysteresis: 8, minExcursion: 25, readyS: 0, topMargin: null, topFloor: null, partialCue: "Go deeper",
    cameraHint: "", rules, proportions: {}, ...options,
  }, ["angle", "lean"], (m) => m);
}

const full = (n: number, v: number) => Array.from({ length: n }, () => v);

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

  it("stops counting a rep when a no_rep rule fires", () => {
    const ex = makeExercise(rule({ id: "hinge", metric: "lean", aggregate: "max", max: 100, noRep: true, cue: "Hips back", priority: 3 }));
    const angles = repCurve(90);
    const updates = run(ex, [...angles, ...angles], [...angles.map(() => 150), ...angles.map(() => 60)]);
    const [blocked, good] = completed(updates);
    expect(blocked).toMatchObject({ counted: false, index: null, faults: ["hinge"] });
    expect(isClean(good)).toBe(true);
    expect(good.index).toBe(1);
    expect(ex.reps).toBe(1);
    expect(updates.slice(0, 60).flatMap((u) => u.cues.map((c) => c.id))).toEqual(["hinge"]);
  });

  it("reports only why a blocked rep didn't count", () => {
    const ex = makeExercise(
      rule({ id: "depth", metric: "angle", aggregate: "min", max: 100, cue: "Deeper", priority: 3 }),
      rule({ id: "hinge", metric: "lean", aggregate: "max", max: 100, noRep: true, cue: "Hips back", priority: 3 }),
    );
    const updates = run(ex, repCurve(105), full(60, 150)); // shallow, and not the exercise
    expect(completed(updates)).toMatchObject([{ counted: false, faults: ["hinge"] }]);
    expect(updates.flatMap((u) => u.cues.map((c) => c.id))).toEqual(["hinge"]);
  });

  it("drops a partial that isn't the exercise", () => {
    const ex = makeExercise(rule({ id: "hinge", metric: "lean", aggregate: "max", max: 100, noRep: true, cue: "Hips back", priority: 3 }));
    const updates = run(ex, repCurve(125), full(60, 150)); // like walking up to the camera
    expect(completed(updates)).toEqual([]);
    expect(updates.flatMap((u) => u.cues)).toEqual([]);
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

  it("waits for the user to settle at the top", () => {
    const ex = configuredExercise({ readyS: 1 });
    const gettingUp = Array.from({ length: 30 }, (_, i) => 60 + (115 * i) / 29); // rising from a crouch at the camera
    let updates = run(ex, [...gettingUp, ...full(9, 175), ...repCurve(90)]); // with the end of getting up, under 1 s at the top
    expect(completed(updates)).toEqual([]);
    expect(updates.flatMap((u) => u.cues)).toEqual([]);
    expect(updates.at(-1)!.ready).toBe(false);

    updates = run(ex, [...full(30, 175), ...repCurve(90)], undefined, 99 / FPS);
    expect(updates.at(-1)!.ready).toBe(true);
    expect(completed(updates)).toMatchObject([{ counted: true, index: 1 }]);
  });

  it("settles again after losing tracking", () => {
    const ex = configuredExercise({ readyS: 1 });
    run(ex, full(40, 175));
    expect(ex.ready).toBe(true);
    let last!: ExerciseUpdate;
    for (let i = 0; i < 90; i++) last = ex.update(null, (40 + i) / FPS);
    expect(last.ready).toBe(false);
    expect(completed(run(ex, repCurve(90), undefined, 130 / FPS))).toEqual([]);
  });

  it("learns the top from how the user stands", () => {
    const ex = configuredExercise({ readyS: 1, topMargin: 10, topFloor: 130 });
    run(ex, full(31, 156)); // stands at 156 while settling
    expect([ex.ready, ex.standing, ex.top]).toEqual([true, 156, 146]);
    // Each rep only comes back up to 155: under the configured 160, over the learned 146.
    const reps = completed(run(ex, [...repCurve(90, 155), ...repCurve(90, 155), ...repCurve(90, 155)], undefined, 31 / FPS));
    expect(reps.map((r) => r.counted)).toEqual([true, true, true]);
  });

  it("measures partial reps from standing, not the learned top", () => {
    const ex = configuredExercise({ readyS: 1, topMargin: 10, topFloor: 130 });
    run(ex, full(31, 160));
    expect(ex.top).toBe(150);
    // 28 below standing is a real attempt, though only 18 below the learned top.
    const [rep] = completed(run(ex, repCurve(132, 160), undefined, 31 / FPS));
    expect(rep).toMatchObject({ counted: false, faults: ["partial"] });
  });

  it("takes quantiles like numpy", () => {
    const values = [3, 1, 4, 1.5, 9, 2.6];
    // numpy.quantile(values, [0, 0.25, 0.5, 0.9, 1])
    expect([0, 0.25, 0.5, 0.9, 1].map((q) => quantile(values, q))).toEqual([1, 1.775, 2.8, 6.5, 9].map((v) => expect.closeTo(v, 9)));
  });

  it("keeps the learned top within its limits", () => {
    const tall = configuredExercise({ readyS: 1, topMargin: 10, topFloor: 145 });
    run(tall, full(31, 178));
    expect(tall.top).toBe(160); // never stricter than configured
    const bent = configuredExercise({ readyS: 1, topMargin: 10, topFloor: 145 });
    run(bent, full(31, 153));
    expect(bent.top).toBe(145);
  });

  it("relearns the top after losing tracking", () => {
    const ex = configuredExercise({ readyS: 1, topMargin: 10, topFloor: 130 });
    run(ex, full(31, 170));
    expect(ex.top).toBe(160);
    for (let i = 0; i < 90; i++) ex.update(null, (31 + i) / FPS);
    expect([ex.ready, ex.standing]).toEqual([false, null]);
    run(ex, full(31, 156), undefined, 121 / FPS);
    expect(ex.top).toBe(146);
  });

  it("needs a sensible floor for a learned top", () => {
    const base = { name: "X", primary_metric: "a", top_threshold: 160, bottom_threshold: 120, top_margin: 10 };
    for (const extra of [{}, { top_floor: 125 }, { top_floor: 165 }]) {
      expect(() => parseConfig({ ...base, ...extra })).toThrow(/top_floor/);
    }
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
    expect(limits("average", "average")).toEqual([50, 0.58]);
    expect(limits("long", "short")).toEqual([65, 0.58]);
    expect(limits("short", "long")).toEqual([40, 0.58]);
    expect(limits("long", "long")).toEqual([53, 0.58]);
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
