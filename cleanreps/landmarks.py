"""MediaPipe pose landmark indices and skeleton layout."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class Landmark(IntEnum):
    NOSE = 0
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT = 31
    RIGHT_FOOT = 32


NUM_LANDMARKS = 33


@dataclass(frozen=True)
class Side:
    """Landmark indices for one side of the body."""

    name: str
    shoulder: int
    elbow: int
    wrist: int
    hip: int
    knee: int
    ankle: int
    heel: int
    foot: int


LEFT = Side("left", 11, 13, 15, 23, 25, 27, 29, 31)
RIGHT = Side("right", 12, 14, 16, 24, 26, 28, 30, 32)

# Body skeleton drawn in the overlay (face landmarks are left out on purpose).
SKELETON: tuple[tuple[int, int], ...] = (
    (11, 12), (11, 23), (12, 24), (23, 24),
    (11, 13), (13, 15), (12, 14), (14, 16),
    (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
    (24, 26), (26, 28), (28, 30), (30, 32), (28, 32),
)
