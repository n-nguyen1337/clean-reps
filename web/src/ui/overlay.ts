// Skeleton overlay, shared by the live view and the set replay.

import { SKELETON } from "../engine/pose";

/** What drawing needs from a pose: a live PoseFrame or a replayed PoseView. */
export interface DrawablePose {
  img(i: number): ArrayLike<number>;
  visible(...ids: number[]): boolean;
}

const BONE_WIDTH = 3; // CSS pixels
const BONE_HALO = 5.5;
const JOINT_RADIUS = 4;

/** Canvas pixels per on-screen pixel, so the skeleton looks the same on a phone, a laptop and in the replay. */
function canvasScale(canvas: HTMLCanvasElement): number {
  const shown = Math.min(canvas.clientWidth / canvas.width, canvas.clientHeight / canvas.height);
  return shown > 0 ? 1 / shown : 1;
}

export function drawPose(ctx: CanvasRenderingContext2D, pose: DrawablePose | null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!pose) return;
  const scale = canvasScale(ctx.canvas);
  ctx.lineCap = "round";
  // A dark halo first, so the bones stay readable against sand and sky.
  for (const [width, color] of [[BONE_HALO, "rgba(16,18,17,0.4)"], [BONE_WIDTH, "rgba(238,241,236,0.92)"]] as const) {
    ctx.lineWidth = width * scale;
    ctx.strokeStyle = color;
    for (const [a, b] of SKELETON) {
      if (!pose.visible(a, b)) continue;
      ctx.beginPath();
      ctx.moveTo(pose.img(a)[0], pose.img(a)[1]);
      ctx.lineTo(pose.img(b)[0], pose.img(b)[1]);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#b2dc78";
  for (let i = 11; i < 33; i++) {
    if (!pose.visible(i)) continue;
    ctx.beginPath();
    ctx.arc(pose.img(i)[0], pose.img(i)[1], JOINT_RADIUS * scale, 0, 2 * Math.PI);
    ctx.fill();
  }
}
