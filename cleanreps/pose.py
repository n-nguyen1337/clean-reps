"""MediaPipe PoseLandmarker wrapper and landmark smoothing."""

from __future__ import annotations

import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision

from .filters import OneEuroFilter
from .landmarks import LEFT, RIGHT, Side

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_{v}/float16/latest/pose_landmarker_{v}.task"
)
MODEL_VARIANTS = ("lite", "full", "heavy")


def ensure_model(variant: str = "full", model_dir: Path = MODEL_DIR) -> Path:
    """Return the path to a pose model, downloading it on first use."""
    if variant not in MODEL_VARIANTS:
        raise ValueError(f"model variant must be one of {MODEL_VARIANTS}, got {variant!r}")
    path = model_dir / f"pose_landmarker_{variant}.task"
    if not path.exists():
        model_dir.mkdir(parents=True, exist_ok=True)
        print(f"Downloading pose model '{variant}' to {path} ...")
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL.format(v=variant), tmp)
        tmp.replace(path)
    return path


@dataclass
class PoseFrame:
    """Landmarks for one detected person in one frame."""

    image: np.ndarray  # (33, 3) pixel x, y and relative depth z (pixel scale)
    world: np.ndarray  # (33, 3) meters, origin between the hips
    visibility: np.ndarray  # (33,) 0-1
    timestamp_ms: int

    def visible(self, *ids: int, threshold: float = 0.5) -> bool:
        return bool(np.all(self.visibility[list(ids)] >= threshold))

    def best_side(self, *parts: str) -> Side:
        """The body side facing the camera, judged by the given parts' visibility."""
        def score(side: Side) -> float:
            return float(sum(self.visibility[getattr(side, p)] for p in parts))
        return LEFT if score(LEFT) >= score(RIGHT) else RIGHT

    def view(self, front_ratio: float = 0.45) -> str:
        """'front' or 'side', from shoulder width relative to torso length."""
        ls, rs = self.image[LEFT.shoulder, :2], self.image[RIGHT.shoulder, :2]
        lh, rh = self.image[LEFT.hip, :2], self.image[RIGHT.hip, :2]
        torso = np.linalg.norm((ls + rs) / 2 - (lh + rh) / 2)
        if torso < 1e-6:
            return "side"
        return "front" if np.linalg.norm(ls - rs) / torso >= front_ratio else "side"


class PoseEstimator:
    """Runs MediaPipe PoseLandmarker in VIDEO mode (synchronous, tracked)."""

    def __init__(self, variant: str = "full", min_confidence: float = 0.5):
        options = vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(ensure_model(variant))),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=min_confidence,
            min_pose_presence_confidence=min_confidence,
            min_tracking_confidence=min_confidence,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_ts = -1

    def process(self, frame_bgr: np.ndarray, timestamp_ms: int) -> PoseFrame | None:
        # VIDEO mode requires strictly increasing timestamps.
        ts = max(int(timestamp_ms), self._last_ts + 1)
        self._last_ts = ts

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = self._landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts
        )
        if not result.pose_landmarks:
            return None

        h, w = frame_bgr.shape[:2]
        lms, world_lms = result.pose_landmarks[0], result.pose_world_landmarks[0]
        image = np.array([[lm.x * w, lm.y * h, lm.z * w] for lm in lms])
        world = np.array([[lm.x, lm.y, lm.z] for lm in world_lms])
        visibility = np.array([lm.visibility or 0.0 for lm in lms])
        return PoseFrame(image, world, visibility, ts)

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> PoseEstimator:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class PoseSmoother:
    """Applies One Euro filtering to image and world landmarks."""

    def __init__(self, min_cutoff: float = 1.5, image_beta: float = 0.01, world_beta: float = 2.0):
        self._image = OneEuroFilter(min_cutoff, image_beta)
        self._world = OneEuroFilter(min_cutoff, world_beta)

    def __call__(self, pose: PoseFrame | None) -> PoseFrame | None:
        if pose is None:
            self.reset()
            return None
        t = pose.timestamp_ms / 1000.0
        return replace(pose, image=self._image(pose.image, t), world=self._world(pose.world, t))

    def reset(self) -> None:
        self._image.reset()
        self._world.reset()
