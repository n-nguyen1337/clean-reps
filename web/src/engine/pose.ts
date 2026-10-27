// Pose landmarks for one person in one frame, plus smoothing
// (port of cleanreps/landmarks.py and the PoseFrame/PoseSmoother parts of pose.py).

import { OneEuroFilter } from "./filters";

export const NUM_LANDMARKS = 33;

export interface Side {
  name: "left" | "right";
  shoulder: number; elbow: number; wrist: number;
  hip: number; knee: number; ankle: number; heel: number; foot: number;
}
export type Part = Exclude<keyof Side, "name">;

export const LEFT: Side = { name: "left", shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 };
export const RIGHT: Side = { name: "right", shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 };

// Body skeleton drawn in the overlay (face landmarks are left out on purpose).
export const SKELETON: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

type Points = Float64Array; // flat (33 * 3)
const sq = (x: number, y: number) => x * x + y * y;

export class PoseFrame {
  constructor(
    readonly image: Points, // pixel x, y and relative depth z (pixel scale)
    readonly world: Points, // meters, origin between the hips
    readonly visibility: Float64Array, // 0-1
    readonly timestampMs: number,
  ) {}

  /** Build from rows of [x, y, z], as in the parity fixtures. */
  static fromRows(image: number[][], world: number[][], visibility: number[], timestampMs: number) {
    return new PoseFrame(Float64Array.from(image.flat()), Float64Array.from(world.flat()),
      Float64Array.from(visibility), timestampMs);
  }

  img(i: number): Points { return this.image.subarray(i * 3, i * 3 + 3); }
  w(i: number): Points { return this.world.subarray(i * 3, i * 3 + 3); }

  visible(...ids: number[]): boolean {
    return ids.every((i) => this.visibility[i] >= 0.5);
  }

  /** The body side facing the camera, judged by the given parts' visibility. */
  bestSide(...parts: Part[]): Side {
    const score = (s: Side) => parts.reduce((sum, p) => sum + this.visibility[s[p]], 0);
    return score(LEFT) >= score(RIGHT) ? LEFT : RIGHT;
  }

  /** 'front' or 'side', from shoulder width relative to torso length. */
  view(frontRatio = 0.45): "front" | "side" {
    const [ls, rs, lh, rh] = [LEFT.shoulder, RIGHT.shoulder, LEFT.hip, RIGHT.hip].map((i) => this.img(i));
    const torso = Math.sqrt(sq((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2));
    if (torso < 1e-6) return "side";
    return Math.sqrt(sq(ls[0] - rs[0], ls[1] - rs[1])) / torso >= frontRatio ? "front" : "side";
  }
}

/** Applies One Euro filtering to image and world landmarks. */
export class PoseSmoother {
  private image: OneEuroFilter;
  private world: OneEuroFilter;

  constructor(minCutoff = 1.5, imageBeta = 0.01, worldBeta = 2.0) {
    this.image = new OneEuroFilter(minCutoff, imageBeta);
    this.world = new OneEuroFilter(minCutoff, worldBeta);
  }

  apply(pose: PoseFrame | null): PoseFrame | null {
    if (pose === null) {
      this.reset();
      return null;
    }
    const t = pose.timestampMs / 1000;
    return new PoseFrame(this.image.apply(pose.image, t), this.world.apply(pose.world, t),
      pose.visibility, pose.timestampMs);
  }

  reset(): void {
    this.image.reset();
    this.world.reset();
  }
}
