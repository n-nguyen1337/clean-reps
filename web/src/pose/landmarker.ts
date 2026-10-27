// MediaPipe PoseLandmarker in the browser (counterpart of PoseEstimator in cleanreps/pose.py).

import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { NUM_LANDMARKS, PoseFrame } from "../engine/pose";

export type ModelVariant = "lite" | "full";

/** Phones get the lite model; laptops and desktops get full. */
export function defaultModel(): ModelVariant {
  const forced = new URLSearchParams(location.search).get("model");
  if (forced === "lite" || forced === "full") return forced;
  return matchMedia("(pointer: coarse)").matches ? "lite" : "full";
}

const asset = (path: string) => new URL(path, document.baseURI).href;

export async function createLandmarker(variant: ModelVariant): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(asset("mediapipe/"));
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: asset(`models/pose_landmarker_${variant}.task`), delegate },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (err) {
    console.warn("GPU delegate unavailable, using CPU", err);
    return PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

/** Convert a result to pixel-space image landmarks, as the Python side does. */
export function toPoseFrame(result: PoseLandmarkerResult, width: number, height: number, ts: number): PoseFrame | null {
  const lms = result.landmarks[0];
  const world = result.worldLandmarks[0];
  if (!lms || !world) return null;
  const image = new Float64Array(NUM_LANDMARKS * 3);
  const worldPts = new Float64Array(NUM_LANDMARKS * 3);
  const visibility = new Float64Array(NUM_LANDMARKS);
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    image.set([lms[i].x * width, lms[i].y * height, lms[i].z * width], i * 3);
    worldPts.set([world[i].x, world[i].y, world[i].z], i * 3);
    visibility[i] = lms[i].visibility || 0;
  }
  return new PoseFrame(image, worldPts, visibility, ts);
}
