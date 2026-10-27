// Self-host MediaPipe's wasm runtime and the pose models under public/.
// Runs before `dev` and `build`; skips files that are already there.

import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const MODEL_URL = (v) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`;

const wasmDir = join(pub, "mediapipe");
if (!existsSync(wasmDir)) {
  // Skip the ES-module build: FilesetResolver only loads it when asked to (useModule).
  cpSync(join(root, "node_modules/@mediapipe/tasks-vision/wasm"), wasmDir, {
    recursive: true,
    filter: (src) => !src.includes("vision_wasm_module_internal"),
  });
  console.log("Copied MediaPipe wasm to public/mediapipe");
}

mkdirSync(join(pub, "models"), { recursive: true });
for (const v of ["lite", "full"]) {
  const dest = join(pub, "models", `pose_landmarker_${v}.task`);
  if (existsSync(dest)) continue;
  const local = join(root, "..", "models", `pose_landmarker_${v}.task`); // the Python app's copy
  if (existsSync(local)) {
    copyFileSync(local, dest);
    console.log(`Copied ${v} model from ../models`);
    continue;
  }
  console.log(`Downloading ${v} model...`);
  const res = await fetch(MODEL_URL(v));
  if (!res.ok) throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${dest}.part`, dest);
}
