/**
 * A small solid figure for each exercise, side on, with the muscles the movement works picked out in the accent.
 * Each limb is a tapered capsule between two joints; overlapping capsules in one fill read as a single silhouette.
 * Drawn in a 100 × 80 box.
 */
type Limb = [x1: number, y1: number, r1: number, x2: number, y2: number, r2: number];
type Muscle = { cx: number; cy: number; rx: number; ry: number; tilt: number };
type Figure = { head: [number, number, number]; limbs: Limb[]; muscles: Muscle[]; shadow: [number, number, number] };

const FIGURES: Record<string, Figure> = {
  // The bottom of a squat: thighs about parallel, torso leaning forward, arms out for balance.
  squat: {
    head: [52, 20.5, 5.6],
    limbs: [
      [31, 50, 6.6, 54, 52, 4.6], // thigh
      [54, 52, 4.2, 40, 71, 2.6], // shin
      [40, 71, 2.5, 50, 72.6, 1.7], // foot
      [31, 50, 6.6, 46, 30, 5.6], // torso
      [46, 30, 3.2, 59, 32, 2.6], // upper arm
      [59, 32, 2.6, 72, 33, 2.1], // forearm
      [46, 30, 2.6, 51, 22, 2.6], // neck
    ],
    muscles: [{ cx: 40, cy: 50, rx: 12, ry: 3.6, tilt: 5 }], // quads and glutes
    shadow: [40, 76.4, 17],
  },
  // The top of a push-up: a straight plank, arms straight under the shoulders.
  pushup: {
    head: [90.5, 40.5, 5.6],
    limbs: [
      [15, 70, 1.8, 11, 65, 2.3], // foot
      [11, 65, 2.4, 33.1, 58.3, 3.9], // shin
      [33.1, 58.3, 4.1, 50.3, 53, 6.2], // thigh
      [50.3, 53, 6.2, 80, 44, 5.8], // torso
      [80, 44, 3.4, 80, 57, 2.7], // upper arm
      [80, 57, 2.6, 80, 70, 2.2], // forearm
      [80, 70, 2, 85.5, 70.6, 1.7], // hand
    ],
    muscles: [
      { cx: 71.5, cy: 48.1, rx: 7.5, ry: 3.3, tilt: -16.9 }, // chest
      { cx: 79.2, cy: 50.6, rx: 1.6, ry: 4.8, tilt: 0 }, // triceps
    ],
    shadow: [48, 74, 40],
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

/** The four corners of a limb's tapered side edges; the round ends are circles drawn at each joint. */
function limbOutline([x1, y1, r1, x2, y2, r2]: Limb): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const nx = -(y2 - y1) / length;
  const ny = (x2 - x1) / length;
  const corners = [[x1 + nx * r1, y1 + ny * r1], [x2 + nx * r2, y2 + ny * r2], [x2 - nx * r2, y2 - ny * r2], [x1 - nx * r1, y1 - ny * r1]];
  return `M${corners.map(([x, y]) => `${round(x)} ${round(y)}`).join(" ")}Z`;
}

/** One circle per joint, as wide as the widest limb end that meets there. */
function jointCircles(limbs: Limb[]): [number, number, number][] {
  const joints = new Map<string, [number, number, number]>();
  for (const [x1, y1, r1, x2, y2, r2] of limbs) {
    for (const [x, y, r] of [[x1, y1, r1], [x2, y2, r2]] as const) {
      const key = `${x},${y}`;
      const seen = joints.get(key);
      if (!seen || seen[2] < r) joints.set(key, [x, y, r]);
    }
  }
  return [...joints.values()];
}

const SHAPES = Object.fromEntries(
  Object.entries(FIGURES).map(([key, f]) => [key, { outline: f.limbs.map(limbOutline).join(""), joints: jointCircles(f.limbs) }]),
);

export function ExerciseGlyph({ exercise }: { exercise: string }) {
  const figure = FIGURES[exercise];
  if (!figure) return <span className="glyph" />;
  const { outline, joints } = SHAPES[exercise];
  const [sx, sy, srx] = figure.shadow;
  return (
    <svg className="glyph" viewBox="0 0 100 80" aria-hidden="true">
      <ellipse className="shadow" cx={sx} cy={sy} rx={srx} ry="1.8" />
      <g className="body">
        <path d={outline} />
        {joints.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />)}
        <circle cx={figure.head[0]} cy={figure.head[1]} r={figure.head[2]} />
      </g>
      <g className="muscle">
        {figure.muscles.map((m) => (
          <ellipse key={`${m.cx}-${m.cy}`} cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} transform={m.tilt ? `rotate(${m.tilt} ${m.cx} ${m.cy})` : undefined} />
        ))}
      </g>
    </svg>
  );
}
