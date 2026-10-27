// Per-exercise metrics (port of cleanreps/exercises/{squat,pushup,curl}.py).
// Thresholds and rules come from the Python package's YAML files, so both
// sides always run the same rules.

import { parse } from "yaml";
import curlYaml from "../../../cleanreps/rules/curl.yaml?raw";
import pushupYaml from "../../../cleanreps/rules/pushup.yaml?raw";
import squatYaml from "../../../cleanreps/rules/squat.yaml?raw";
import { Exercise, parseConfig, type Metrics } from "./exercise";
import { angle, angleFromVertical, lineOffset } from "./geometry";
import { LEFT, RIGHT, type PoseFrame } from "./pose";

interface ExerciseDef {
  yaml: string;
  metrics: readonly string[];
  compute: (pose: PoseFrame, m: Metrics) => void;
}

const DEFS: Record<string, ExerciseDef> = {
  squat: {
    yaml: squatYaml,
    metrics: ["knee_angle", "hip_angle", "torso_lean", "knee_ratio"],
    compute(pose, m) {
      const s = pose.bestSide("hip", "knee", "ankle");
      if (pose.visible(s.hip, s.knee, s.ankle)) m.knee_angle = angle(pose.w(s.hip), pose.w(s.knee), pose.w(s.ankle));
      if (pose.visible(s.shoulder, s.hip, s.knee)) m.hip_angle = angle(pose.w(s.shoulder), pose.w(s.hip), pose.w(s.knee));

      const view = pose.view();
      if (view === "side" && pose.visible(s.shoulder, s.hip)) {
        // Forward lean only shows up from the side.
        m.torso_lean = angleFromVertical(pose.img(s.hip), pose.img(s.shoulder));
      }
      if (view === "front" && pose.visible(LEFT.knee, RIGHT.knee, LEFT.ankle, RIGHT.ankle)) {
        // Knees caving in: knee spread shrinks relative to ankle spread.
        const ankleGap = Math.abs(pose.img(LEFT.ankle)[0] - pose.img(RIGHT.ankle)[0]);
        if (ankleGap > 1) m.knee_ratio = Math.abs(pose.img(LEFT.knee)[0] - pose.img(RIGHT.knee)[0]) / ankleGap;
      }
    },
  },
  pushup: {
    yaml: pushupYaml,
    metrics: ["elbow_angle", "hip_offset"],
    compute(pose, m) {
      const s = pose.bestSide("shoulder", "elbow", "wrist", "hip", "ankle");
      if (pose.visible(s.shoulder, s.elbow, s.wrist)) m.elbow_angle = angle(pose.w(s.shoulder), pose.w(s.elbow), pose.w(s.wrist));
      if (pose.view() === "side" && pose.visible(s.shoulder, s.hip, s.ankle)) {
        // Positive: hips sag below the shoulder-ankle line. Negative: piked up.
        m.hip_offset = lineOffset(pose.img(s.hip), pose.img(s.shoulder), pose.img(s.ankle));
      }
    },
  },
  curl: {
    yaml: curlYaml,
    metrics: ["elbow_angle", "elbow_drift", "torso_lean"],
    compute(pose, m) {
      const s = pose.bestSide("shoulder", "elbow", "wrist");
      if (pose.visible(s.shoulder, s.elbow, s.wrist)) {
        m.elbow_angle = angle(pose.w(s.shoulder), pose.w(s.elbow), pose.w(s.wrist));
        // Upper arm angle away from hanging straight down.
        m.elbow_drift = 180 - angleFromVertical(pose.img(s.shoulder), pose.img(s.elbow));
      }
      if (pose.visible(s.shoulder, s.hip)) m.torso_lean = angleFromVertical(pose.img(s.hip), pose.img(s.shoulder));
    },
  },
};

export const EXERCISE_KEYS = Object.keys(DEFS);

export function createExercise(key: string): Exercise<PoseFrame> {
  const def = DEFS[key];
  if (!def) throw new Error(`unknown exercise ${JSON.stringify(key)}`);
  return new Exercise(key, parseConfig(parse(def.yaml)), def.metrics, (pose) => {
    const m: Metrics = Object.fromEntries(def.metrics.map((n) => [n, null]));
    def.compute(pose, m);
    return m;
  });
}
