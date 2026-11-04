import { describe, expect, it } from "vitest";
import { SkeletonFilter } from "../filters";
import { NUM_LANDMARKS, PoseFrame, SkeletonSmoother } from "../pose";

// Shared with TestSkeletonFilter in tests/test_geometry_filters.py: 3 joints at 30 fps,
// joint 1 thrown for one frame and then really moved, joint 2 hovering at the confidence limit.
const INPUT: [number[], number[]][] = [
  [[100, 200, 300, 400, 500, 600], [.9, .9, .45]],
  [[102, 203, 300, 401, 500, 600], [.9, .9, .55]],
  [[106, 209, 420, 401, 501, 601], [.9, .9, .45]],
  [[112, 218, 300, 402, 501, 600], [.9, .9, .35]],
  [[120, 230, 301, 402, 500, 601], [.9, .9, .25]],
  [[130, 245, 301, 403, 500, 600], [.9, .9, .45]],
  [[130, 245, 450, 403, 500, 600], [.9, .9, .55]],
  [[130, 245, 450, 403, 500, 600], [.9, .9, .55]],
];
const OUTPUT: [number[], number[]][] = [
  [[100.0, 200.0, 300.0, 400.0, 500.0, 600.0], [1, 1, 0]],
  [[100.586052, 200.879078, 300.0, 400.254834, 500.0, 600.0], [1, 1, 1]],
  [[102.744195, 204.116292, 300.0, 400.257739, 500.261179, 600.261179], [1, 1, 1]],
  [[107.537867, 211.3068, 300.0, 400.735351, 500.458248, 600.195614], [1, 1, 1]],
  [[115.310405, 222.965608, 300.284713, 401.10585, 500.344411, 600.405122], [1, 1, 0]],
  [[125.753785, 238.630678, 300.505788, 401.692477, 500.261488, 600.30884], [1, 1, 0]],
  [[130.095934, 245.143901, 300.522905, 401.73947, 500.198056, 600.234195], [1, 1, 1]],
  [[131.604187, 247.40628, 422.794704, 402.774961, 500.149193, 600.176532], [1, 1, 1]],
];

describe("SkeletonFilter", () => {
  it("matches the values shared with the Python reference", () => {
    const f = new SkeletonFilter();
    INPUT.forEach(([xy, vis], i) => {
      const out = f.apply(xy, vis, i / 30);
      Array.from(out.xy).forEach((v, j) => expect(v).toBeCloseTo(OUTPUT[i][0][j], 4));
      expect(Array.from(out.shown)).toEqual(OUTPUT[i][1]);
    });
  });

  it("means the same at any resolution", () => {
    const run = (longSide: number) => {
      const f = new SkeletonFilter();
      const scale = longSide / 1280;
      let last: Float64Array = new Float64Array();
      INPUT.forEach(([xy, vis], i) => { last = f.apply(xy.map((v) => v * scale), vis, i / 30, longSide).xy; });
      return Array.from(last, (v) => v / scale);
    };
    const reference = run(1280);
    run(640).forEach((v, i) => expect(v).toBeCloseTo(reference[i], 6));
  });

  it("starts over after a reset", () => {
    const f = new SkeletonFilter();
    f.apply([100, 100], [1], 0);
    f.reset();
    expect(f.apply([400, 100], [1], 1 / 30).xy[0]).toBe(400);
  });
});

describe("SkeletonSmoother", () => {
  const frame = (x: number, ts: number, visibility = 0.9) => new PoseFrame(
    Float64Array.from({ length: NUM_LANDMARKS * 3 }, (_, i) => (i % 3 === 0 ? x : i % 3 === 1 ? 50 : -7)),
    new Float64Array(NUM_LANDMARKS * 3).fill(3),
    new Float64Array(NUM_LANDMARKS).fill(visibility), ts);

  it("filters x and y only, and reports shown joints as visibility", () => {
    const s = new SkeletonSmoother();
    s.apply(frame(100, 0), 1280);
    const out = s.apply(frame(110, 33), 1280)!;
    expect(out.img(11)[0]).toBeGreaterThan(100);
    expect(out.img(11)[0]).toBeLessThan(110);
    expect(out.img(11)[1]).toBeCloseTo(50, 6);
    expect(out.img(11)[2]).toBe(-7);
    expect(out.w(11)[0]).toBe(3);
    expect(out.visibility[11]).toBe(1);
    expect(s.apply(frame(110, 66, 0.1), 1280)!.visible(11)).toBe(false);
  });

  it("forgets the old position when tracking is lost", () => {
    const s = new SkeletonSmoother();
    s.apply(frame(100, 0), 1280);
    expect(s.apply(null, 1280)).toBeNull();
    expect(s.apply(frame(500, 66), 1280)!.img(11)[0]).toBeCloseTo(500, 6);
  });

  it("leaves the raw pose alone", () => {
    const s = new SkeletonSmoother();
    s.apply(frame(100, 0), 1280);
    const raw = frame(110, 33);
    s.apply(raw, 1280);
    expect(raw.img(11)[0]).toBe(110);
    expect(raw.visibility[11]).toBe(0.9);
  });
});
