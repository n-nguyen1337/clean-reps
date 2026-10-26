from __future__ import annotations

from ..geometry import angle, angle_from_vertical
from ..landmarks import LEFT, RIGHT
from ..pose import PoseFrame
from .base import Exercise


class Squat(Exercise):
    key = "squat"
    METRICS = ("knee_angle", "hip_angle", "torso_lean", "knee_ratio")

    def compute_metrics(self, pose: PoseFrame) -> dict[str, float | None]:
        m: dict[str, float | None] = dict.fromkeys(self.METRICS)
        s = pose.best_side("hip", "knee", "ankle")
        w, img = pose.world, pose.image

        if pose.visible(s.hip, s.knee, s.ankle):
            m["knee_angle"] = angle(w[s.hip], w[s.knee], w[s.ankle])
        if pose.visible(s.shoulder, s.hip, s.knee):
            m["hip_angle"] = angle(w[s.shoulder], w[s.hip], w[s.knee])

        view = pose.view()
        if view == "side" and pose.visible(s.shoulder, s.hip):
            # Forward lean only shows up from the side.
            m["torso_lean"] = angle_from_vertical(img[s.hip], img[s.shoulder])
        if view == "front" and pose.visible(LEFT.knee, RIGHT.knee, LEFT.ankle, RIGHT.ankle):
            # Knees caving in: knee spread shrinks relative to ankle spread.
            ankle_gap = abs(img[LEFT.ankle, 0] - img[RIGHT.ankle, 0])
            if ankle_gap > 1:
                m["knee_ratio"] = float(abs(img[LEFT.knee, 0] - img[RIGHT.knee, 0]) / ankle_gap)
        return m
