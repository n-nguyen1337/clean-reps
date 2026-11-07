/**
 * A small solid figure for each exercise, side on: the end of the movement in front, a faded echo of where it starts
 * behind, and the muscles the movement works picked out in the accent. Each limb is a tapered capsule between two
 * joints; overlapping capsules in one fill read as a single silhouette. Drawn in a 100 × 80 box.
 */
type Limb = [x1: number, y1: number, r1: number, x2: number, y2: number, r2: number];
type Pose = { head: [x: number, y: number, r: number]; limbs: Limb[] };
type Muscle = { cx: number; cy: number; rx: number; ry: number; tilt: number };
type Figure = {
  start: Pose;
  end: Pose;
  muscles: Muscle[];
  shadow: [cx: number, cy: number, rx: number, ry: number];
  /** Shrinks a figure whose start pose would not fit the box, keeping its feet on the same floor. */
  frame?: string;
};

const FIGURES: Record<string, Figure> = {
  squat: {
    // Standing tall, arms by the sides.
    start: {
      head: [42, -12, 5.6],
      limbs: [
        [40, 71, 2.5, 50, 72.6, 1.7], // foot
        [40, 71, 2.6, 41, 47.4, 4.4], // shin
        [41, 47.4, 4.6, 40, 24.4, 6.4], // thigh
        [40, 24.4, 6.4, 40.5, -0.6, 5.6], // torso
        [40.5, -0.6, 3.2, 41.5, 12.4, 2.6], // upper arm
        [41.5, 12.4, 2.6, 42.5, 25.4, 2.1], // forearm
        [40.5, -0.6, 2.6, 41.5, -8, 2.6], // neck
      ],
    },
    // The bottom: thighs about parallel, torso leaning forward, arms out for balance.
    end: {
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
    },
    muscles: [{ cx: 40, cy: 50, rx: 12, ry: 3.6, tilt: 5 }], // quads and glutes
    shadow: [42, 76.4, 20, 2],
    frame: "translate(8 15) scale(0.8)",
  },
  pushup: {
    // The top: a straight plank, arms straight under the shoulders.
    start: {
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
    },
    // The bottom: chest just off the floor, elbows bent back along the body.
    end: {
      head: [93.5, 56.5, 5.6],
      limbs: [
        [15, 70, 1.8, 11, 65, 2.3], // foot
        [11, 65, 2.4, 34, 63.4, 3.9], // shin
        [34, 63.4, 4.1, 52, 62.15, 6.2], // thigh
        [52, 62.15, 6.2, 82.9, 60, 5.8], // torso
        [82.9, 60, 3.4, 70.1, 61.7, 2.7], // upper arm
        [70.1, 61.7, 2.6, 80, 70, 2.2], // forearm
        [80, 70, 2, 85.5, 70.6, 1.7], // hand
      ],
    },
    muscles: [{ cx: 73.7, cy: 62.4, rx: 7.5, ry: 3, tilt: -3.9 }], // chest
    shadow: [50, 74, 42, 1.8],
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

function PoseShape({ pose, className }: { pose: Pose; className: string }) {
  return (
    <g className={className}>
      <path d={pose.limbs.map(limbOutline).join("")} />
      {jointCircles(pose.limbs).map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />)}
      <circle cx={pose.head[0]} cy={pose.head[1]} r={pose.head[2]} />
    </g>
  );
}

export function ExerciseGlyph({ exercise }: { exercise: string }) {
  const figure = FIGURES[exercise];
  if (!figure) return <span className="glyph" />;
  const [sx, sy, srx, sry] = figure.shadow;
  return (
    <svg className="glyph" viewBox="0 0 100 80" aria-hidden="true">
      <g transform={figure.frame}>
        <ellipse className="shadow" cx={sx} cy={sy} rx={srx} ry={sry} />
        {/* The echo fades as one group, so the overlapping limb pieces inside it don't stack into darker spots. */}
        <PoseShape pose={figure.start} className="body echo" />
        <PoseShape pose={figure.end} className="body" />
        <g className="muscle">
          {figure.muscles.map((m) => (
            <ellipse key={`${m.cx}-${m.cy}`} cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} transform={`rotate(${m.tilt} ${m.cx} ${m.cy})`} />
          ))}
        </g>
      </g>
    </svg>
  );
}
