from __future__ import annotations

from ..geometry import angle, line_offset
from ..pose import PoseFrame
from .base import Exercise


class PushUp(Exercise):
    key = "pushup"
    METRICS = ("elbow_angle", "hip_offset")

    def compute_metrics(self, pose: PoseFrame) -> dict[str, float | None]:
        m: dict[str, float | None] = dict.fromkeys(self.METRICS)
        s = pose.best_side("shoulder", "elbow", "wrist", "hip", "ankle")
        w, img = pose.world, pose.image

        if pose.visible(s.shoulder, s.elbow, s.wrist):
            m["elbow_angle"] = angle(w[s.shoulder], w[s.elbow], w[s.wrist])
        if pose.view() == "side" and pose.visible(s.shoulder, s.hip, s.ankle):
            # Positive: hips sag below the shoulder-ankle line. Negative: piked up.
            m["hip_offset"] = line_offset(img[s.hip], img[s.shoulder], img[s.ankle])
        return m
