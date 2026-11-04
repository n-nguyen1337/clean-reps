// One Euro filter for smoothing landmark jitter (port of cleanreps/filters.py).
// Casiez et al., "1€ Filter" (CHI 2012). Low cutoff when still (kills jitter),
// higher cutoff when moving fast (keeps lag low).

const alpha = (dt: number, cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

/** Element-wise One Euro filter over fixed-length arrays. */
export class OneEuroFilter {
  private x: Float64Array | null = null;
  private dx: Float64Array | null = null;
  private t = 0;

  constructor(
    readonly minCutoff = 1.0,
    readonly beta = 0.0,
    readonly dCutoff = 1.0,
  ) {}

  reset(): void {
    this.x = this.dx = null;
  }

  apply(input: ArrayLike<number>, t: number): Float64Array {
    const x = Float64Array.from(input);
    if (this.x === null || this.dx === null || this.x.length !== x.length) {
      this.x = x.slice();
      this.dx = new Float64Array(x.length);
      this.t = t;
      return x;
    }
    const dt = t - this.t;
    if (dt <= 0) return this.x.slice();

    const aD = alpha(dt, this.dCutoff);
    for (let i = 0; i < x.length; i++) {
      const dxHat = this.dx[i] + aD * ((x[i] - this.x[i]) / dt - this.dx[i]);
      const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
      this.x[i] += alpha(dt, cutoff) * (x[i] - this.x[i]);
      this.dx[i] = dxHat;
    }
    this.t = t;
    return this.x.slice();
  }
}

/** Long side, in pixels, of the frame SkeletonFilter's speeds and jumps are measured in. */
const REFERENCE_LONG_SIDE = 1280;

/** Tuned with tools/tune_skeleton.py. Lab exports record them next to what they drew. */
export const SKELETON_SETTINGS = { ahead: 2, minCutoff: 1, beta: 0.2, settle: 0.1, jump: 80, fadeFrom: 0.3, fadeTo: 0.5, fadeHz: 2, maxGap: 0.1 };

interface FilterFrame {
  t: number;
  /** Flat [x, y] pairs at the reference size, with too-large jumps held. Null for a frame with no pose. */
  z: Float64Array | null;
  visibility: ArrayLike<number> | null;
}

export interface SkeletonOutput {
  /** The frame this belongs to, `ahead` frames back. */
  t: number;
  /** Flat [x, y] pairs in pixels. Null if that frame had no pose. */
  xy: Float64Array | null;
  /** Per joint, from 0 to 1. */
  opacity: Float64Array | null;
}

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/**
 * Smoothing for the skeleton on screen (port of SkeletonFilter in
 * cleanreps/filters.py, which explains the design). The engine keeps its own
 * One Euro filter. Positions are flat [x, y] pairs in pixels. Each new frame
 * gives back the frame `ahead` before it, smoothed with the frames since.
 */
export class SkeletonFilter {
  private frames: FilterFrame[] = [];
  private far = new Uint8Array(0);
  private x: Float64Array | null = null;
  private opacity = new Float64Array(0);
  private t = 0;

  constructor(private readonly s = SKELETON_SETTINGS) {}

  reset(): void {
    this.frames = [];
    this.x = null;
  }

  /** The widest window around frame `c` with a pose on every frame and no stall. */
  private radius(c: number): number {
    const { frames, s } = this;
    for (let r = s.ahead; r > 0; r--) {
      if (c - r < 0) continue;
      let whole = true;
      for (let k = c - r; k <= c + r && whole; k++) {
        whole = frames[k].z !== null && (k === c + r || frames[k + 1].t - frames[k].t <= s.maxGap);
      }
      if (whole) return r;
    }
    return 0;
  }

  /** Frame `k`'s positions with single-frame throws removed, where it has neighbours to judge by. */
  private steady(k: number): Float64Array {
    const { frames } = this;
    const z = frames[k].z!;
    const before = k > 0 ? frames[k - 1].z : null;
    const after = k < frames.length - 1 ? frames[k + 1].z : null;
    return before && after ? z.map((v, i) => median3(before[i], v, after[i])) : z;
  }

  /** Add a frame: flat pixel positions and visibility, or nulls for no pose. Null until there are enough frames. */
  push(xy: ArrayLike<number> | null, visibility: ArrayLike<number> | null, t: number, longSide = REFERENCE_LONG_SIDE): SkeletonOutput | null {
    const { frames, s } = this;
    const scale = REFERENCE_LONG_SIDE / longSide;
    let z: Float64Array | null = null;
    if (xy) {
      z = Float64Array.from(xy, (v) => v * scale);
      const last = frames.at(-1);
      const far = new Uint8Array(z.length / 2);
      if (last?.z && last.z.length === z.length) {
        // A stall between frames legitimately moves joints further.
        const limit = s.jump * Math.max((t - last.t) * 30, 1);
        for (let i = 0; i < far.length; i++) {
          const [ix, iy] = [i * 2, i * 2 + 1];
          if (Math.hypot(z[ix] - last.z[ix], z[iy] - last.z[iy]) <= limit) continue;
          far[i] = 1;
          // Held for a frame: accepted if it's still there on the next one.
          if (!this.far[i]) [z[ix], z[iy]] = [last.z[ix], last.z[iy]];
        }
      }
      this.far = far;
    }
    frames.push({ t, z, visibility });
    if (frames.length > 2 * s.ahead + 2) frames.shift();

    const c = frames.length - 1 - s.ahead;
    if (c < 0) return null;
    const { t: tc, z: zc, visibility: vis } = frames[c];
    if (!zc || !vis) {
      this.x = null;
      return { t: tc, xy: null, opacity: null };
    }

    const r = this.radius(c);
    const window = Array.from({ length: 2 * r + 1 }, (_, k) => this.steady(c - r + k));
    const smoothed = new Float64Array(zc.length);
    const total = (r + 1) * (r + 1); // of the triangular weights
    window.forEach((p, k) => {
      const weight = (r + 1 - Math.abs(k - r)) / total;
      for (let i = 0; i < smoothed.length; i++) smoothed[i] += weight * p[i];
    });

    const joints = zc.length / 2;
    const speed = new Float64Array(joints);
    if (r) {
      const mean = (from: number, to: number) => {
        let sum = 0;
        for (let k = from; k < to; k++) sum += frames[k].t;
        return sum / (to - from);
      };
      const span = mean(c + 1, c + r + 1) - mean(c - r, c);
      for (let j = 0; j < joints; j++) {
        let dx = 0, dy = 0;
        for (let k = 1; k <= r; k++) {
          dx += window[r + k][j * 2] - window[r - k][j * 2];
          dy += window[r + k][j * 2 + 1] - window[r - k][j * 2 + 1];
        }
        speed[j] = Math.hypot(dx / r, dy / r) / span;
      }
    } else if (c > 0 && frames[c - 1].z && tc > frames[c - 1].t) {
      const prev = frames[c - 1].z!;
      for (let j = 0; j < joints; j++) {
        speed[j] = Math.hypot(zc[j * 2] - prev[j * 2], zc[j * 2 + 1] - prev[j * 2 + 1]) / (tc - frames[c - 1].t);
      }
    }

    const target = Float64Array.from({ length: joints }, (_, j) =>
      Math.min(Math.max((vis[j] - s.fadeFrom) / (s.fadeTo - s.fadeFrom), 0), 1));
    const dt = tc - this.t;
    if (!this.x || this.x.length !== smoothed.length || dt <= 0 || dt > s.maxGap) {
      this.x = smoothed;
      this.opacity = target;
    } else {
      const fade = alpha(dt, s.fadeHz);
      for (let j = 0; j < joints; j++) {
        const [dx, dy] = [smoothed[j * 2] - this.x[j * 2], smoothed[j * 2 + 1] - this.x[j * 2 + 1]];
        const a = alpha(dt, s.minCutoff + s.beta * Math.max(speed[j], Math.hypot(dx, dy) / s.settle));
        this.x[j * 2] += a * dx;
        this.x[j * 2 + 1] += a * dy;
        this.opacity[j] += fade * (target[j] - this.opacity[j]);
      }
    }
    this.t = tc;
    return { t: tc, xy: this.x.map((v) => v / scale), opacity: this.opacity.slice() };
  }
}
