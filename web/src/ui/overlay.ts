// Skeleton overlay, shared by the live view and the set replay.

import { SKELETON } from "../engine/pose";

/** What drawing needs from a pose: a live PoseFrame or a replayed PoseView. */
export interface DrawablePose {
  img(i: number): ArrayLike<number>;
  visible(...ids: number[]): boolean;
}

export function drawPose(ctx: CanvasRenderingContext2D, pose: DrawablePose | null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!pose) return;
  const scale = ctx.canvas.width / 640;
  ctx.lineWidth = 4 * scale;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  for (const [a, b] of SKELETON) {
    if (!pose.visible(a, b)) continue;
    ctx.beginPath();
    ctx.moveTo(pose.img(a)[0], pose.img(a)[1]);
    ctx.lineTo(pose.img(b)[0], pose.img(b)[1]);
    ctx.stroke();
  }
  ctx.fillStyle = "#c8f031";
  for (let i = 11; i < 33; i++) {
    if (!pose.visible(i)) continue;
    ctx.beginPath();
    ctx.arc(pose.img(i)[0], pose.img(i)[1], 5 * scale, 0, 2 * Math.PI);
    ctx.fill();
  }
}
