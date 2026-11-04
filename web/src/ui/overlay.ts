// Skeleton overlay, shared by the live view and the set replay.

import { SKELETON, type DrawablePose } from "../engine/pose";

// Widths and radii are CSS pixels, so the skeleton looks the same on a phone, a laptop and in the replay.
const LOOK = {
  bone: 2.5,
  boneColor: "rgba(255,255,255,0.94)",
  // A soft dark edge under everything, so white stays readable against a pale wall.
  shade: 4.5,
  shadeColor: "rgba(12,14,13,0.3)",
  // Each joint is an accent dot in a white ring, a node on the line.
  joint: 2.5,
  jointColor: "#b2dc78",
  ring: 1.25,
  ringColor: "#ffffff",
};

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const MAX_DENSITY = 3;
const SOLID = 0.99; // opacities above this draw together
const GONE = 0.02;

/**
 * Size the canvas to the pixels it covers on screen, not to the camera's frame:
 * a fine line drawn at the frame's size and scaled up comes out soft. Returns
 * canvas pixels per frame pixel, and frame pixels per CSS pixel.
 */
function fitCanvas(canvas: HTMLCanvasElement, frame: { width: number; height: number }) {
  const shown = Math.min(canvas.clientWidth / frame.width, canvas.clientHeight / frame.height);
  if (!(shown > 0)) {
    if (canvas.width !== frame.width || canvas.height !== frame.height) Object.assign(canvas, frame);
    return { density: 1, perCss: 1 };
  }
  const density = shown * Math.min(window.devicePixelRatio || 1, MAX_DENSITY);
  const [width, height] = [Math.round(frame.width * density), Math.round(frame.height * density)];
  if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
  return { density, perCss: 1 / shown };
}

function strokeBones(ctx: CanvasRenderingContext2D, pose: DrawablePose, width: number, color: string) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.beginPath();
  const fading: [number, number, number][] = [];
  for (const [a, b] of SKELETON) {
    const opacity = Math.min(pose.opacity(a), pose.opacity(b));
    if (opacity < GONE) continue;
    if (opacity < SOLID) {
      fading.push([a, b, opacity]);
      continue;
    }
    ctx.moveTo(pose.img(a)[0], pose.img(a)[1]);
    ctx.lineTo(pose.img(b)[0], pose.img(b)[1]);
  }
  ctx.stroke();
  for (const [a, b, opacity] of fading) {
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(pose.img(a)[0], pose.img(a)[1]);
    ctx.lineTo(pose.img(b)[0], pose.img(b)[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function fillJoints(ctx: CanvasRenderingContext2D, pose: DrawablePose, radius: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const fading: [number, number][] = [];
  for (const i of JOINTS) {
    const opacity = pose.opacity(i);
    if (opacity < GONE) continue;
    if (opacity < SOLID) {
      fading.push([i, opacity]);
      continue;
    }
    const [x, y] = pose.img(i) as Float64Array;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
  }
  ctx.fill();
  for (const [i, opacity] of fading) {
    const [x, y] = pose.img(i) as Float64Array;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Draw `pose`, whose positions are pixels of a camera frame of the given size. */
export function drawPose(ctx: CanvasRenderingContext2D, pose: DrawablePose | null, frame: { width: number; height: number }) {
  const { canvas } = ctx;
  const { density, perCss } = fitCanvas(canvas, frame);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pose) return;
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokeBones(ctx, pose, LOOK.shade * perCss, LOOK.shadeColor);
  strokeBones(ctx, pose, LOOK.bone * perCss, LOOK.boneColor);
  fillJoints(ctx, pose, (LOOK.joint + LOOK.ring + (LOOK.shade - LOOK.bone) / 2) * perCss, LOOK.shadeColor);
  fillJoints(ctx, pose, (LOOK.joint + LOOK.ring) * perCss, LOOK.ringColor);
  fillJoints(ctx, pose, LOOK.joint * perCss, LOOK.jointColor);
}
