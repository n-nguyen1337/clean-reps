import { SKELETON } from "../../engine/pose";
import { at, type Point } from "./squat";

/** The tracked skeleton, drawn the way the live view draws it (LOOK in ui/overlay.ts): white bones, joints in the accent. */
export function Skeleton({ p, scale = 1 }: { p: Point[]; scale?: number }) {
  return (
    <g className="skeleton">
      {SKELETON.map(([a, b]) => {
        const pa = at(p, a), pb = at(p, b);
        return pa && pb && <line key={`${a}-${b}`} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} strokeWidth={0.045 * scale} />;
      })}
      {p.map((_, i) => {
        const q = at(p, i + 11);
        const joint = i + 11;
        const attached = SKELETON.some(([a, b]) => (a === joint && at(p, b)) || (b === joint && at(p, a)));
        return q && attached && (joint < 17 || (joint > 22 && joint < 29)) && <circle key={i} cx={q[0]} cy={q[1]} r={0.05 * scale} strokeWidth={0.024 * scale} />;
      })}
    </g>
  );
}

/** The knee the tracker saw best, for labelling its angle. */
export const knee = (p: Point[]) => at(p, 26) ?? at(p, 25);

/** A frame of the clip with its tracked skeleton laid over it. */
export function PosePhoto({ src, viewBox, p, kneeAngle, alt, scale, eager = false }: {
  src: string; viewBox: string; p: Point[]; kneeAngle?: number; alt: string; scale?: number;
  /** For a photo on the first screen. */
  eager?: boolean;
}) {
  const k = knee(p);
  const [, , , h] = viewBox.split(" ").map(Number);
  const fs = h * 0.05;
  return (
    <div className="pose-photo">
      <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} />
      <svg viewBox={viewBox} aria-hidden="true">
        <Skeleton p={p} scale={scale} />
        {k && kneeAngle !== undefined && (
          <text className="knee-label" x={k[0] + fs * 0.6} y={k[1] - fs * 0.5} fontSize={fs}>{Math.round(kneeAngle)}°</text>
        )}
      </svg>
    </div>
  );
}
