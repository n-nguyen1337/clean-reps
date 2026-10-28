import { describe, expect, it } from "vitest";
import { analyze, worstValue } from "../analysis";
import type { ExerciseConfig, RepResult, Rule } from "../exercise";
import { Session } from "../session";

const rule = (r: Partial<Rule> & Pick<Rule, "id" | "metric" | "cue">): Rule =>
  ({ priority: 1, min: null, max: null, aggregate: null, minFrames: 3, noRep: false, ...r });

const config: ExerciseConfig = {
  name: "Squat", primaryMetric: "knee_angle", topThreshold: 160, bottomThreshold: 120,
  hysteresis: 8, minExcursion: 25, readyS: 1, topMargin: null, topFloor: null, partialCue: "Go deeper", cameraHint: "", proportions: {},
  rules: [
    rule({ id: "depth", metric: "knee_angle", aggregate: "min", max: 100, cue: "Squat a little deeper" }),
    rule({ id: "torso_lean", metric: "torso_lean", max: 50, cue: "Chest up" }),
    rule({ id: "knee_valgus", metric: "knee_ratio", min: 0.8, cue: "Push your knees out" }),
  ],
};

let clock = 0;
function rep(bottom: number, opts: { lean?: number; faults?: string[]; down?: number; up?: number; counted?: boolean } = {}): RepResult {
  const { lean = 30, faults = [], down = 1.5, up = 1.2, counted = true } = opts;
  const startS = clock;
  clock += down + up + 0.5;
  return {
    counted, index: counted ? 0 : null, startS, bottomS: startS + down, endS: startS + down + up, faults,
    extremes: { knee_angle: [bottom, 175], torso_lean: [10, lean] },
  };
}
const numbered = (reps: RepResult[]) => {
  let n = 0;
  return reps.map((r) => (r.counted ? { ...r, index: ++n } : r));
};

describe("worstValue", () => {
  it("takes the side of the extremes the rule checks", () => {
    const extremes = { knee_angle: [92, 175] as [number, number], knee_ratio: [0.7, 1.1] as [number, number] };
    expect(worstValue(config.rules[0], extremes)).toBe(92);
    expect(worstValue(config.rules[2], extremes)).toBe(0.7);
    expect(worstValue(config.rules[1], extremes)).toBeNull();
  });
});

describe("analyze", () => {
  it("labels counted and partial reps and builds per-rule series", () => {
    const a = analyze(config, numbered([rep(95), rep(140, { counted: false, faults: ["partial"] }), rep(97, { lean: 55, faults: ["torso_lean"] })]));
    expect(a.rows.map((r) => r.label)).toEqual(["1", "P1", "2"]);
    const lean = a.rules.find((r) => r.rule.id === "torso_lean")!;
    expect(lean.faultSide).toBe("above");
    expect(lean.points.map((p) => [p.label, p.value, p.faulted])).toEqual([["1", 30, false], ["2", 55, true]]);
    expect(a.rules.find((r) => r.rule.id === "knee_valgus")!.faultSide).toBe("below");
  });

  it("flags fading depth, a frequent fault and an unmeasured metric", () => {
    const reps = numbered([95, 96, 95, 104, 108, 110].map((b) => rep(b, { lean: 55, faults: ["torso_lean"] })));
    const texts = analyze(config, reps).insights.map((i) => `${i.tone}: ${i.text}`);
    expect(texts.some((t) => t.startsWith("warn: Depth faded") && t.includes("14° shallower"))).toBe(true);
    expect(texts.some((t) => t.startsWith('warn: "Chest up" on 6 of 6 reps'))).toBe(true);
    expect(texts.some((t) => t.startsWith("info: Knee width ÷ ankle width wasn't measured"))).toBe(true);
    expect(texts.some((t) => t === "good: Deepest rep: #1 at 95°.")).toBe(true);
  });

  it("praises consistency and notes slowing up-phase, warnings first", () => {
    const reps = numbered([1, 1, 1, 1.2, 1.8, 1.9].map((up) => rep(95, { up })));
    const a = analyze(config, reps);
    const texts = a.insights.map((i) => i.text);
    expect(texts).toContain("Very consistent depth (±0° between reps).");
    expect(texts.some((t) => t.startsWith("Standing up slowed by 85%"))).toBe(true);
    const tones = a.insights.map((i) => i.tone);
    expect(tones).toEqual([...tones].sort((x, y) => ["warn", "good", "info"].indexOf(x) - ["warn", "good", "info"].indexOf(y)));
  });

  it("handles a set with no reps", () => {
    expect(analyze(config, []).insights).toEqual([{ tone: "info", text: "No reps recorded. Check that your whole body is in frame." }]);
  });
});

describe("Session.sample", () => {
  it("downsamples the trace to 10 Hz", () => {
    const s = new Session("squat");
    for (let i = 0; i < 90; i++) s.sample(i / 30, { knee_angle: 170 - i });
    expect(s.trace).toHaveLength(30);
    expect(s.trace[1].t).toBeCloseTo(0.1, 5);
  });
});
