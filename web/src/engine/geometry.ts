// Vector helpers for joint angles and body alignment (port of cleanreps/geometry.py).
// Image-space functions assume pixel coordinates with y pointing down.

export type Vec = ArrayLike<number>;

const norm = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);
const rad2deg = (r: number) => (r * 180) / Math.PI;

/** Angle ABC at vertex b in degrees (0-180). Uses 3D when all points have a z. */
export function angle(a: Vec, b: Vec, c: Vec): number {
  const dims = Math.min(a.length, b.length, c.length);
  const ba = [0, 0, 0], bc = [0, 0, 0];
  for (let i = 0; i < dims; i++) {
    ba[i] = a[i] - b[i];
    bc[i] = c[i] - b[i];
  }
  const denom = norm(ba[0], ba[1], ba[2]) * norm(bc[0], bc[1], bc[2]);
  if (denom < 1e-9) return NaN;
  const cos = (ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2]) / denom;
  return rad2deg(Math.acos(Math.min(1, Math.max(-1, cos))));
}

/** Angle in degrees between the image vector a->b and straight up.
 *  0 means b is directly above a, 90 horizontal, 180 directly below. */
export function angleFromVertical(a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return NaN;
  return rad2deg(Math.atan2(Math.abs(dx), -dy));
}

/** Distance of point p from line a-b, as a fraction of |ab|.
 *  Positive when p sits below the line in the image (y down), negative above. */
export function lineOffset(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return NaN;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  const cx = a[0] + t * dx, cy = a[1] + t * dy;
  const dist = norm(p[0] - cx, p[1] - cy) / Math.sqrt(lengthSq);
  // math.copysign: the sign of zero still counts.
  return p[1] - cy < 0 || Object.is(p[1] - cy, -0) ? -dist : dist;
}
