from __future__ import annotations

from ..geometry import angle, angle_from_vertical
from ..pose import PoseFrame
from .base import Exercise


class BicepCurl(Exercise):
    key = "curl"
    METRICS = ("elbow_angle", "elbow_drift", "torso_lean")

    def compute_metrics(self, pose: PoseFrame) -> dict[str, float | None]:
        m: dict[str, float | None] = dict.fromkeys(self.METRICS)
        s = pose.best_side("shoulder", "elbow", "wrist")
        w, img = pose.world, pose.image

        if pose.visible(s.shoulder, s.elbow, s.wrist):
            m["elbow_angle"] = angle(w[s.shoulder], w[s.elbow], w[s.wrist])
            # Upper arm angle away from hanging straight down.
            m["elbow_drift"] = 180.0 - angle_from_vertical(img[s.shoulder], img[s.elbow])
        if pose.visible(s.shoulder, s.hip):
            m["torso_lean"] = angle_from_vertical(img[s.hip], img[s.shoulder])
        return m
