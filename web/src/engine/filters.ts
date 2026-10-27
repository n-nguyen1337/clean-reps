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
