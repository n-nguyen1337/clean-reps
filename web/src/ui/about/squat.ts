// One stock squat clip (Pexels video 7426039) and the pose cleanReps tracked in it, for the About page.
// Built from web/fixtures by a one-off script: joints 11-32 as [x, y] fractions of the 16:9 frame,
// null where the tracker wasn't confident, plus the knee angle and hip height the engine measured.

import data from "../../assets/about/squat-demo.json";

export type Point = [number, number] | null;
export interface Still { p: Point[]; knee: number; hip: number }
export interface Frame { t: number; p: Point[]; knee: number | null; hip: number | null }

export const SQUAT = data as unknown as {
  source: string; joints: number[]; crop: [number, number, number, number];
  hero: Still; phases: Record<"standing" | "lowering" | "bottom" | "rising", Still>; frames: Frame[];
};

/** Frame units: 16 wide by 9 tall, so a viewBox keeps the clip's shape. */
export const FW = 16, FH = 9;
export const at = (p: Point[], joint: number): [number, number] | null => {
  const q = p[joint - SQUAT.joints[0]];
  return q && [q[0] * FW, q[1] * FH];
};

/** The phase photos' crop as a viewBox over the frame. */
export const CROP_BOX = (() => {
  const [x, y, w, h] = SQUAT.crop;
  return `${x * FW} ${y * FH} ${w * FW} ${h * FH}`;
})();
