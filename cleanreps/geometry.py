"""Vector helpers for joint angles and body alignment.

Image-space functions assume pixel coordinates with y pointing down.
"""

from __future__ import annotations

import math

import numpy as np


def angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle ABC at vertex b in degrees (0-180). Works in 2D or 3D."""
    ba = np.asarray(a, float) - np.asarray(b, float)
    bc = np.asarray(c, float) - np.asarray(b, float)
    denom = np.linalg.norm(ba) * np.linalg.norm(bc)
    if denom < 1e-9:
        return float("nan")
    cos = np.clip(np.dot(ba, bc) / denom, -1.0, 1.0)
    return math.degrees(math.acos(cos))


def angle_from_vertical(a: np.ndarray, b: np.ndarray) -> float:
    """Angle in degrees between the image vector a->b and straight up.

    0 means b is directly above a, 90 horizontal, 180 directly below.
    """
    dx = float(b[0] - a[0])
    dy = float(b[1] - a[1])
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return float("nan")
    return math.degrees(math.atan2(abs(dx), -dy))


def line_offset(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Distance of point p from segment line a-b, as a fraction of |ab|.

    Positive when p sits below the line in the image (y down), negative above.
    The sign does not depend on which way the person is facing.
    """
    p, a, b = (np.asarray(v[:2], float) for v in (p, a, b))
    d = b - a
    length_sq = float(np.dot(d, d))
    if length_sq < 1e-9:
        return float("nan")
    t = float(np.dot(p - a, d)) / length_sq
    closest = a + t * d
    dist = float(np.linalg.norm(p - closest)) / math.sqrt(length_sq)
    return math.copysign(dist, p[1] - closest[1])


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(np.asarray(a, float) - np.asarray(b, float)))
