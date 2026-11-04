/** A small tracked figure for each exercise, drawn like the live overlay: bones, with joints in the accent. */
const POSES: Record<string, { head: [number, number]; bones: string; joints: [number, number][] }> = {
  squat: {
    head: [26, 8.5],
    bones: "M38 19 22 16 11.5 27 26.5 28.5 21 41.5 30 41.5",
    joints: [[22, 16], [11.5, 27], [26.5, 28.5], [21, 41.5]],
  },
  pushup: {
    head: [39.5, 17.5],
    bones: "M6 37.5 7 33 20 28 33.5 23 34 31 33 39.5",
    joints: [[7, 33], [20, 28], [33.5, 23], [34, 31]],
  },
};

export function ExerciseGlyph({ exercise }: { exercise: string }) {
  const pose = POSES[exercise];
  if (!pose) return <span className="glyph" />;
  return (
    <svg className="glyph" viewBox="0 0 48 48" aria-hidden="true">
      <circle className="head" cx={pose.head[0]} cy={pose.head[1]} r="4" />
      <path className="bones" d={pose.bones} />
      <g className="joints">{pose.joints.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />)}</g>
    </svg>
  );
}
