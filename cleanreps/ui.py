"""OpenCV overlay: skeleton, rep counter, metrics and the active cue."""

from __future__ import annotations

import cv2
import numpy as np

from .exercises import Cue, ExerciseConfig, ExerciseUpdate, RepResult
from .landmarks import SKELETON
from .pose import PoseFrame

FONT = cv2.FONT_HERSHEY_SIMPLEX
WHITE = (255, 255, 255)
GREEN = (80, 200, 120)
RED = (60, 60, 230)
AMBER = (40, 180, 250)
DARK = (30, 30, 30)


def _text(img, text: str, org: tuple[int, int], scale: float = 0.7,
          color=WHITE, thickness: int = 2, bg=DARK) -> int:
    """Draw text on a filled box; returns the box's bottom y."""
    (w, h), base = cv2.getTextSize(text, FONT, scale, thickness)
    x, y = org
    pad = 8
    cv2.rectangle(img, (x - pad, y - h - pad), (x + w + pad, y + base + pad), bg, -1)
    cv2.putText(img, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)
    return y + base + pad


def draw_pose(img: np.ndarray, pose: PoseFrame, threshold: float = 0.5) -> None:
    pts = pose.image[:, :2].astype(int)
    for a, b in SKELETON:
        if pose.visibility[a] >= threshold and pose.visibility[b] >= threshold:
            cv2.line(img, tuple(pts[a]), tuple(pts[b]), WHITE, 3, cv2.LINE_AA)
    for i, (x, y) in enumerate(pts[11:], start=11):
        if pose.visibility[i] >= threshold:
            cv2.circle(img, (x, y), 5, GREEN, -1, cv2.LINE_AA)


def draw_hud(img: np.ndarray, config: ExerciseConfig, update: ExerciseUpdate,
             cue: Cue | None, last_rep: RepResult | None, fps: float) -> None:
    h, w = img.shape[:2]

    y = _text(img, f"{config.name}  REPS {update.reps}", (20, 40), 1.0, thickness=2)
    y = _text(img, f"Phase: {update.phase.value}", (20, y + 28), 0.6)
    for name, value in update.metrics.items():
        if value is not None:
            y = _text(img, f"{name}: {value:.1f}", (20, y + 24), 0.55)

    if last_rep is not None:
        if last_rep.clean:
            verdict, color = f"Rep {last_rep.index}: clean", GREEN
        elif last_rep.counted:
            verdict, color = f"Rep {last_rep.index}: {', '.join(last_rep.faults)}", AMBER
        else:
            verdict, color = "No rep: partial", RED
        _text(img, verdict, (20, h - 30), 0.7, color=color)

    if not update.tracking:
        _text(img, "Body not detected", (w - 260, 40), 0.6, color=RED)
    _text(img, f"{fps:4.1f} fps", (w - 120, h - 30), 0.5)

    if cue is not None:
        color = GREEN if cue.id == "good_rep" else AMBER
        (tw, _), _ = cv2.getTextSize(cue.text, FONT, 1.1, 3)
        _text(img, cue.text, ((w - tw) // 2, h - 90), 1.1, color=color, thickness=3)
