// Per-exercise metrics (port of cleanreps/exercises/{squat,pushup}.py).
// Thresholds and rules come from the Python package's YAML files, so both
// sides always run the same rules.

import { parse } from "yaml";
import pushupYaml from "../../../cleanreps/rules/pushup.yaml?raw";
import squatYaml from "../../../cleanreps/rules/squat.yaml?raw";
import { AVERAGE_BODY, Exercise, forBody, parseConfig, type Body, type Metrics } from "./exercise";
import { angle, angleFromVertical, distance, lineOffset } from "./geometry";
import { LEFT, RIGHT, type PoseFrame } from "./pose";

interface ExerciseDef {
  yaml: string;
  metrics: readonly string[];
  compute: (pose: PoseFrame, m: Metrics) => void;
}

const DEFS: Record<string, ExerciseDef> = {
  squat: {
    yaml: squatYaml,
    metrics: ["knee_angle", "hip_angle", "torso_lean", "knee_ratio", "hip_height"],
    compute(pose, m) {
      const s = pose.bestSide("hip", "knee", "ankle");
      if (pose.visible(s.hip, s.knee, s.ankle)) m.knee_angle = angle(pose.w(s.hip), pose.w(s.knee), pose.w(s.ankle));
      if (pose.visible(s.shoulder, s.hip, s.knee)) m.hip_angle = angle(pose.w(s.shoulder), pose.w(s.hip), pose.w(s.knee));
      if (pose.visible(s.hip, s.knee, s.ankle)) {
        // How high the hips are over the ankles, as a fraction of leg length: about 1 standing,
        // under 0.5 at parallel. Mostly a vertical distance, which the model gets right from any
        // side, unlike the knee angle, which needs depth that a front view can't see.
        const leg = distance(pose.w(s.hip), pose.w(s.knee)) + distance(pose.w(s.knee), pose.w(s.ankle));
        if (leg > 1e-6) m.hip_height = (pose.w(s.ankle)[1] - pose.w(s.hip)[1]) / leg;
      }

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
};

export const EXERCISE_KEYS = Object.keys(DEFS);

export function createExercise(key: string, body: Body = AVERAGE_BODY): Exercise<PoseFrame> {
  const def = DEFS[key];
  if (!def) throw new Error(`unknown exercise ${JSON.stringify(key)}`);
  return new Exercise(key, forBody(parseConfig(parse(def.yaml)), body), def.metrics, (pose) => {
    const m: Metrics = Object.fromEntries(def.metrics.map((n) => [n, null]));
    def.compute(pose, m);
    return m;
  });
}
