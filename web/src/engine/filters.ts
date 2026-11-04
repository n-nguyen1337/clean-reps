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
export const SKELETON_SETTINGS = { minCutoff: 1.5, beta: 0.015, dCutoff: 2, lead: 0.5, leadSpeed: 450, jump: 80, show: 0.5, hide: 0.3 };

/**
 * Smoothing for the skeleton on screen (port of SkeletonFilter in
 * cleanreps/filters.py, which explains the design). The engine keeps its own
 * One Euro filter. Positions are flat [x, y] pairs in pixels.
 */
export class SkeletonFilter {
  private x: Float64Array | null = null;
  private dx = new Float64Array(0);
  private far = new Uint8Array(0);
  private shown = new Uint8Array(0);
  private t = 0;

  constructor(private readonly s = SKELETON_SETTINGS) {}

  reset(): void {
    this.x = null;
  }

  apply(xy: ArrayLike<number>, visibility: ArrayLike<number>, t: number, longSide = REFERENCE_LONG_SIDE): { xy: Float64Array; shown: Uint8Array } {
    const { s } = this;
    const scale = REFERENCE_LONG_SIDE / longSide;
    const output = (x: Float64Array) => ({ xy: x.map((v) => v / scale), shown: this.shown.slice() });

    if (this.x === null || this.x.length !== xy.length) {
      this.x = Float64Array.from(xy, (v) => v * scale);
      this.dx = new Float64Array(xy.length);
      this.far = new Uint8Array(xy.length / 2);
      this.shown = Uint8Array.from(visibility, (v) => (v >= s.show ? 1 : 0));
      this.t = t;
      return output(this.x);
    }
    const dt = t - this.t;
    if (dt <= 0) return output(this.x);

    const { x, dx, far, shown } = this;
    const aD = alpha(dt, s.dCutoff);
    // A stall between frames legitimately moves joints further.
    const limit = s.jump * Math.max(dt * 30, 1);
    for (let i = 0; i < far.length; i++) {
      const [ix, iy] = [i * 2, i * 2 + 1];
      const lead = s.lead * Math.min(Math.hypot(dx[ix], dx[iy]) / s.leadSpeed, 1) * dt;
      const [px, py] = [x[ix] + lead * dx[ix], x[iy] + lead * dx[iy]];

      let [zx, zy] = [xy[ix] * scale, xy[iy] * scale];
      const isFar = Math.hypot(zx - px, zy - py) > limit;
      if (isFar && !far[i]) [zx, zy] = [px, py]; // held for a frame: accepted if it's still there on the next one
      far[i] = isFar ? 1 : 0;

      dx[ix] += aD * ((zx - x[ix]) / dt - dx[ix]);
      dx[iy] += aD * ((zy - x[iy]) / dt - dx[iy]);
      const a = alpha(dt, s.minCutoff + s.beta * Math.hypot(dx[ix], dx[iy]));
      x[ix] = px + a * (zx - px);
      x[iy] = py + a * (zy - py);
      shown[i] = visibility[i] >= (shown[i] ? s.hide : s.show) ? 1 : 0;
    }
    this.t = t;
    return output(x);
  }
}
