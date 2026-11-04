import { describe, expect, it } from "vitest";
import { SKELETON_SETTINGS, SkeletonFilter } from "../filters";
import { NUM_LANDMARKS, PoseFrame, SkeletonSmoother } from "../pose";

// Shared with TestSkeletonFilter in tests/test_geometry_filters.py: 3 joints at 30 fps,
// joint 1 thrown for one frame and then really moved, joint 2 fading in and out.
const INPUT: [number[], number[]][] = [
  [[100, 200, 300, 400, 500, 600], [.9, .9, .2]],
  [[102, 203, 300, 401, 500, 600], [.9, .9, .3]],
  [[106, 209, 420, 401, 501, 601], [.9, .9, .4]],
  [[112, 218, 300, 402, 501, 600], [.9, .9, .5]],
  [[120, 230, 301, 402, 500, 601], [.9, .9, .6]],
  [[130, 245, 301, 403, 500, 600], [.9, .9, .5]],
  [[140, 260, 450, 403, 500, 600], [.9, .9, .4]],
  [[150, 275, 450, 403, 500, 600], [.9, .9, .3]],
  [[160, 290, 450, 403, 500, 600], [.9, .9, .2]],
  [[170, 305, 450, 403, 500, 600], [.9, .9, .1]],
];
const OUTPUT: ([number[], number[]] | null)[] = [
  null,
  null,
  [[100.0, 200.0, 300.0, 400.0, 500.0, 600.0], [1.0, 1.0, 0.0]],
  [[102.187724, 203.281586, 300.0, 400.341894, 500.113965, 600.0], [1.0, 1.0, 0.0]],
  [[106.922887, 210.38433, 300.051749, 400.751897, 500.292353, 600.134656], [1.0, 1.0, 0.147609]],
  [[112.957739, 219.436609, 300.190003, 401.255591, 500.370055, 600.193309], [1.0, 1.0, 0.399251]],
  [[120.719935, 231.079902, 300.424038, 401.730194, 500.355221, 600.204989], [1.0, 1.0, 0.576603]],
  [[129.811022, 244.716532, 316.922797, 402.637965, 500.273242, 600.173462], [1.0, 1.0, 0.701597]],
  [[139.573036, 259.359554, 350.136293, 402.884945, 500.203152, 600.128967], [1.0, 1.0, 0.642082]],
  [[149.563063, 274.344595, 399.54435, 402.998192, 500.15505, 600.098431], [1.0, 1.0, 0.452528]],
];

/** One joint through the filter at 30 fps: its x per output frame. */
const jointAt = (...points: number[]) => {
  const f = new SkeletonFilter();
  return points.flatMap((x, i) => {
    const out = f.push([x, 100], [1], i / 30);
    return out?.xy ? [out.xy[0]] : [];
  });
};

describe("SkeletonFilter", () => {
  it("matches the values shared with the Python reference", () => {
    const f = new SkeletonFilter();
    INPUT.forEach(([xy, vis], i) => {
      const out = f.push(xy, vis, i / 30);
      const want = OUTPUT[i];
      if (!want) return expect(out).toBeNull();
      Array.from(out!.xy!).forEach((v, j) => expect(v).toBeCloseTo(want[0][j], 4));
      Array.from(out!.opacity!).forEach((v, j) => expect(v).toBeCloseTo(want[1][j], 4));
      expect(out!.t).toBeCloseTo((i - SKELETON_SETTINGS.ahead) / 30, 9);
    });
  });

  it("doesn't trail steady movement", () => {
    const out = jointAt(...Array.from({ length: 20 }, (_, i) => 100 + 10 * i));
    expect(Math.abs(out.at(-1)! - (100 + 10 * 17))).toBeLessThan(1); // the frame two before the last
  });

  it("settles a still joint that shakes", () => {
    const out = jointAt(...Array.from({ length: 40 }, (_, i) => 100 + (-1) ** i)).slice(20);
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(0.2);
  });

  it("ignores a large one-frame throw", () => {
    for (const x of jointAt(100, 100, 100, 100, 400, 100, 100, 100, 100)) expect(x).toBeCloseTo(100, 6);
  });

  it("shrugs off a smaller one-frame throw", () => {
    expect(Math.max(...jointAt(100, 100, 100, 100, 100, 140, 100, 100, 100, 100, 100))).toBeLessThan(106);
  });

  it("accepts a jump that stays", () => {
    expect(jointAt(100, 100, 100, 100, 100, 400, 400, 400, 400, 400, 400, 400, 400).at(-1)).toBeGreaterThan(390);
  });

  it("doesn't smooth across a stall", () => {
    const f = new SkeletonFilter();
    const times = [0, 1 / 30, 2 / 30, 0.5, 0.5 + 1 / 30, 0.5 + 2 / 30];
    const out = [100, 100, 100, 300, 300, 300].map((x, i) => f.push([x, 100], [1], times[i]));
    expect(out[4]!.xy![0]).toBeCloseTo(100, 6); // the last frame before the stall
    expect(out[5]!.xy![0]).toBeCloseTo(300, 6); // the first after it
  });

  it("means the same at any resolution", () => {
    const run = (longSide: number) => {
      const f = new SkeletonFilter();
      const scale = longSide / 1280;
      let last: Float64Array = new Float64Array();
      INPUT.forEach(([xy, vis], i) => {
        last = f.push(xy.map((v) => v * scale), vis, i / 30, longSide)?.xy ?? last;
      });
      return Array.from(last, (v) => v / scale);
    };
    const reference = run(1280);
    run(640).forEach((v, i) => expect(v).toBeCloseTo(reference[i], 6));
  });

  it("gives a frame with no pose back in its turn, and doesn't smooth across it", () => {
    const f = new SkeletonFilter();
    expect(f.push([100, 100], [1], 0)).toBeNull();
    expect(f.push(null, null, 1 / 30)).toBeNull();
    expect(f.push([110, 100], [1], 2 / 30)!.xy![0]).toBeCloseTo(100, 6);
    expect(f.push([120, 100], [1], 3 / 30)).toEqual({ t: 1 / 30, xy: null, opacity: null });
    expect(f.push([130, 100], [1], 4 / 30)!.xy![0]).toBeCloseTo(110, 6);
  });

  it("fades a joint rather than blinking it", () => {
    const f = new SkeletonFilter();
    const seen = Array.from({ length: 50 }, (_, i) => f.push([100, 100], [i < 10 ? 1 : 0], i / 30)?.opacity?.[0] ?? null)
      .filter((v) => v !== null) as number[];
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBeLessThan(0.01);
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(0.3);
  });

  it("starts over after a reset", () => {
    const f = new SkeletonFilter();
    for (let i = 0; i < 5; i++) f.push([100, 100], [1], i / 30);
    f.reset();
    expect(f.push([400, 100], [1], 6 / 30)).toBeNull();
  });
});

describe("SkeletonSmoother", () => {
  const frame = (x: number, ts: number, visibility = 0.9) => new PoseFrame(
    Float64Array.from({ length: NUM_LANDMARKS * 3 }, (_, i) => (i % 3 === 0 ? x : i % 3 === 1 ? 50 : -7)),
    new Float64Array(NUM_LANDMARKS * 3).fill(3),
    new Float64Array(NUM_LANDMARKS).fill(visibility), ts);

  it("gives back the pose for the frame two before, with its time stamp", () => {
    const s = new SkeletonSmoother();
    expect(s.apply(frame(100, 0), 0, 1280)).toBeNull();
    expect(s.apply(frame(110, 33), 33, 1280)).toBeNull();
    const first = s.apply(frame(120, 66), 66, 1280)!;
    expect(first.timestampMs).toBe(0);
    expect(first.pose!.img(11)[0]).toBeCloseTo(100, 6);
    const second = s.apply(frame(130, 99), 99, 1280)!;
    expect(second.timestampMs).toBe(33);
    expect(second.pose!.img(11)[0]).toBeGreaterThan(100);
    expect(second.pose!.img(11)[1]).toBeCloseTo(50, 6);
    expect(second.pose!.opacity(11)).toBe(1);
  });

  it("gives back no pose for a frame that had none", () => {
    const s = new SkeletonSmoother();
    s.apply(null, 0, 1280);
    s.apply(frame(100, 33), 33, 1280);
    expect(s.apply(frame(100, 66), 66, 1280)).toEqual({ timestampMs: 0, pose: null });
    expect(s.apply(frame(100, 99), 99, 1280)!.pose).not.toBeNull();
  });

  it("gives back exactly the stamp it was given, which the lab export matches frames by", () => {
    // 47 / 1000 * 1000 isn't 47 in floating point.
    const s = new SkeletonSmoother();
    expect(s.apply(frame(100, 47), 47, 1280)).toBeNull();
    s.apply(frame(100, 80), 80, 1280);
    expect(s.apply(frame(100, 113), 113, 1280)!.timestampMs).toBe(47);
  });

  it("leaves the raw pose alone", () => {
    const s = new SkeletonSmoother();
    const raw = frame(110, 33);
    s.apply(frame(100, 0), 0, 1280);
    s.apply(raw, 33, 1280);
    s.apply(frame(120, 66), 66, 1280);
    expect(raw.img(11)[0]).toBe(110);
    expect(raw.visibility[11]).toBe(0.9);
  });
});
