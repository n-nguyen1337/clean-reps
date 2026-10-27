import { describe, expect, it } from "vitest";
import type { RepRow } from "../../engine/analysis";
import { NUM_LANDMARKS, PoseFrame } from "../../engine/pose";
import { alignOffset, pickMimeType, PoseTrack, repAt, traceValueAt } from "../playback";

const pose = (x: number, visibility = 0.9) => PoseFrame.fromRows(
  Array.from({ length: NUM_LANDMARKS }, (_, i) => [x + i, 2 * x, 0]),
  Array.from({ length: NUM_LANDMARKS }, () => [0, 0, 0]),
  Array(NUM_LANDMARKS).fill(visibility), 0,
);

describe("pickMimeType", () => {
  it("prefers MP4", () => {
    expect(pickMimeType(() => true)).toBe("video/mp4;codecs=avc1");
  });
  it("falls back to WebM", () => {
    expect(pickMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9");
  });
  it("returns null when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe("PoseTrack", () => {
  const track = new PoseTrack();
  track.push(1.0, pose(10));
  track.push(1.1, pose(20));
  track.push(1.2, null);
  track.push(2.0, pose(30, 0.2));

  it("finds the frame at an exact time", () => {
    const p = track.at(1.1)!;
    expect(Array.from(p.img(0))).toEqual([20, 40]);
    expect(Array.from(p.img(5))).toEqual([25, 40]);
    expect(p.visible(0, 5)).toBe(true);
  });

  it("holds the previous frame between frames", () => {
    expect(Array.from(track.at(1.05)!.img(0))).toEqual([10, 20]);
  });

  it("returns nothing before the first frame or after a long gap", () => {
    expect(track.at(0.9)).toBeNull();
    expect(track.at(1.0 + 0.3, 0.25)).not.toBeNull(); // the null frame at 1.2 is within reach
    expect(track.at(1.6)).toBeNull();
    expect(track.at(5)).toBeNull();
  });

  it("keeps a missing pose as a gap with nothing visible", () => {
    expect(track.at(1.25)!.visible(11)).toBe(false);
  });

  it("keeps visibility", () => {
    expect(track.at(2.0)!.visible(11)).toBe(false);
  });

  it("grows past its initial capacity", () => {
    const long = new PoseTrack();
    for (let i = 0; i < 3000; i++) long.push(i / 30, pose(i));
    expect(long.length).toBe(3000);
    expect(Array.from(long.at(2999 / 30)!.img(0))).toEqual([2999, 5998]);
    expect(Array.from(long.at(10 / 30)!.img(0))).toEqual([10, 20]);
  });
});

describe("repAt", () => {
  const row = (label: string, startS: number, endS: number) =>
    ({ label, rep: { startS, bottomS: (startS + endS) / 2, endS } }) as unknown as RepRow;
  const rows = [row("1", 1, 3), row("2", 4, 6)];

  it("finds the rep in progress", () => {
    expect(repAt(rows, 2)?.label).toBe("1");
    expect(repAt(rows, 4)?.label).toBe("2");
  });
  it("is null between reps", () => {
    expect(repAt(rows, 3.5)).toBeNull();
  });
});

describe("traceValueAt", () => {
  const trace = [0, 0.1, 0.2, 0.6].map((t, i) => ({ t, metrics: { knee_angle: 100 + i, torso_lean: null } }));

  it("uses the nearest sample", () => {
    expect(traceValueAt(trace, "knee_angle", 0.12)).toBe(101);
    expect(traceValueAt(trace, "knee_angle", 0.17)).toBe(102);
  });
  it("is null when no sample is close", () => {
    expect(traceValueAt(trace, "knee_angle", 0.4)).toBeNull();
    expect(traceValueAt([], "knee_angle", 1)).toBeNull();
  });
  it("is null when the metric wasn't measured", () => {
    expect(traceValueAt(trace, "torso_lean", 0.1)).toBeNull();
    expect(traceValueAt(trace, "hip_angle", 0.1)).toBeNull();
  });
});

describe("alignOffset", () => {
  const rec = { offsetS: 3, endS: 30 };

  it("anchors on the end of the recording", () => {
    expect(alignOffset(rec, 29.9)).toBeCloseTo(0.1);
  });
  it("clamps a last frame just past the stop time to zero", () => {
    expect(alignOffset(rec, 30.2)).toBe(0);
  });
  it("falls back to the start estimate when the duration doesn't fit", () => {
    expect(alignOffset(rec, Infinity)).toBe(3);
    expect(alignOffset(rec, NaN)).toBe(3);
    expect(alignOffset(rec, 45)).toBe(3);
  });
});
