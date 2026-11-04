"""One Euro filter for smoothing landmark jitter.

Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy
Input in Interactive Systems" (CHI 2012). Low cutoff when still (kills
jitter), higher cutoff when moving fast (keeps lag low).
"""

from __future__ import annotations

import math
from collections import deque

import numpy as np


def _alpha(dt: float, cutoff: np.ndarray | float) -> np.ndarray | float:
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class OneEuroFilter:
    """Element-wise One Euro filter over numpy arrays of a fixed shape."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.0, d_cutoff: float = 1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.reset()

    def reset(self) -> None:
        self._x: np.ndarray | None = None
        self._dx: np.ndarray | None = None
        self._t: float | None = None

    def __call__(self, x: np.ndarray, t: float) -> np.ndarray:
        x = np.asarray(x, float)
        if self._x is None or self._x.shape != x.shape:
            self._x, self._dx, self._t = x.copy(), np.zeros_like(x), t
            return x.copy()

        dt = t - self._t
        if dt <= 0:
            return self._x.copy()

        dx = (x - self._x) / dt
        dx_hat = self._dx + _alpha(dt, self.d_cutoff) * (dx - self._dx)
        cutoff = self.min_cutoff + self.beta * np.abs(dx_hat)
        x_hat = self._x + _alpha(dt, cutoff) * (x - self._x)

        self._x, self._dx, self._t = x_hat, dx_hat, t
        return x_hat.copy()


#: Long side, in pixels, of the frame SkeletonFilter's speeds and jumps are measured in.
REFERENCE_LONG_SIDE = 1280.0


class SkeletonFilter:
    """Smoothing for the skeleton on screen. The engine keeps its own One Euro filter.

    Tuned with ``tools/tune_skeleton.py``. The model's landmarks stick and then
    jump while the body moves steadily, and a filter that only sees the past
    has to trade lag for smoothing that. The live view draws its own picture,
    so it shows it ``ahead`` frames late, and each frame's pose is worked out
    with that many frames still to come:

    - A one-frame hold on a jump too large to be movement. A jump that's still
      there on the next frame is accepted.
    - A median of 3, for smaller single-frame throws.
    - A triangular window centred on the frame, so it adds no lag.
    - A One Euro stage to settle a joint that's nearly still. Its speed comes
      from both sides of the frame, so it opens before movement reaches the
      picture, and it also opens when the joint has far to go, so a sudden stop
      doesn't leave it creeping into place. One cutoff per joint keeps x and y
      in step.

    A joint fades as the model loses confidence in it, instead of blinking.

    Speeds and jumps are in pixels at a ``REFERENCE_LONG_SIDE`` frame, so a
    camera with another resolution behaves the same.
    """

    def __init__(self, ahead: int = 2, min_cutoff: float = 1.0, beta: float = 0.2, settle: float = 0.1, jump: float = 80.0,
                 fade_from: float = 0.3, fade_to: float = 0.5, fade_hz: float = 2.0, max_gap: float = 0.1):
        self.ahead = ahead
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.settle = settle
        self.jump = jump
        self.fade_from = fade_from
        self.fade_to = fade_to
        self.fade_hz = fade_hz
        self.max_gap = max_gap  # frames further apart than this aren't smoothed together
        self.reset()

    def reset(self) -> None:
        # Each is (t, positions, visibility); the positions are None for a frame with no pose.
        self._frames: deque[tuple[float, np.ndarray | None, np.ndarray | None]] = deque(maxlen=2 * self.ahead + 2)
        self._far: np.ndarray | None = None
        self._x: np.ndarray | None = None
        self._opacity: np.ndarray | None = None
        self._t = 0.0

    def _radius(self, c: int) -> int:
        """The widest window around frame ``c`` with a pose on every frame and no stall."""
        frames = self._frames
        for r in range(self.ahead, 0, -1):
            if c - r >= 0 and all(frames[k][1] is not None for k in range(c - r, c + r + 1)) and all(
                    frames[k + 1][0] - frames[k][0] <= self.max_gap for k in range(c - r, c + r)):
                return r
        return 0

    def _steady(self, k: int) -> np.ndarray:
        """Frame ``k``'s positions with single-frame throws removed, where it has neighbours to judge by."""
        frames = self._frames
        if 0 < k < len(frames) - 1 and frames[k - 1][1] is not None and frames[k + 1][1] is not None:
            return np.median(np.stack([frames[k - 1][1], frames[k][1], frames[k + 1][1]]), axis=0)
        return frames[k][1]

    def __call__(self, xy: np.ndarray | None, visibility: np.ndarray | None, t: float,
                 long_side: float = REFERENCE_LONG_SIDE) -> tuple[np.ndarray | None, np.ndarray | None, float] | None:
        """Add a frame: (n, 2) pixel positions and visibility, or None for no pose.

        Returns the positions, the joints' opacity from 0 to 1, and the time of
        the frame they belong to, ``ahead`` frames back. Those are None if that
        frame had no pose. Returns None until there are enough frames.
        """
        scale = REFERENCE_LONG_SIDE / long_side
        frames = self._frames
        if xy is None:
            frames.append((t, None, None))
        else:
            z = np.asarray(xy, float) * scale
            last = frames[-1] if frames else None
            if last is not None and last[1] is not None and last[1].shape == z.shape:
                # A stall between frames legitimately moves joints further.
                far = np.linalg.norm(z - last[1], axis=1) > self.jump * max((t - last[0]) * 30.0, 1.0)
                z = np.where((far & ~self._far)[:, None], last[1], z)
            else:
                far = np.zeros(len(z), bool)
            self._far = far
            frames.append((t, z, np.asarray(visibility, float)))

        c = len(frames) - 1 - self.ahead
        if c < 0:
            return None
        tc, zc, vis = frames[c]
        if zc is None:
            self._x = self._opacity = None
            return None, None, tc

        r = self._radius(c)
        window = [self._steady(k) for k in range(c - r, c + r + 1)]
        weights = [r + 1 - abs(k) for k in range(-r, r + 1)]
        smoothed = sum(w * p for w, p in zip(weights, window)) / sum(weights)
        if r:
            span = np.mean([frames[k][0] for k in range(c + 1, c + r + 1)]) - np.mean([frames[k][0] for k in range(c - r, c)])
            moved = np.mean(window[r + 1:], axis=0) - np.mean(window[:r], axis=0)
            speed = np.linalg.norm(moved, axis=1, keepdims=True) / span
        elif c > 0 and frames[c - 1][1] is not None and tc > frames[c - 1][0]:
            speed = np.linalg.norm(zc - frames[c - 1][1], axis=1, keepdims=True) / (tc - frames[c - 1][0])
        else:
            speed = np.zeros((len(zc), 1))

        target = np.clip((vis - self.fade_from) / (self.fade_to - self.fade_from), 0.0, 1.0)
        dt = tc - self._t
        if self._x is None or self._x.shape != smoothed.shape or dt <= 0 or dt > self.max_gap:
            self._x, self._opacity = smoothed, target
        else:
            left = smoothed - self._x
            speed = np.maximum(speed, np.linalg.norm(left, axis=1, keepdims=True) / self.settle)
            self._x = self._x + _alpha(dt, self.min_cutoff + self.beta * speed) * left
            self._opacity = self._opacity + _alpha(dt, self.fade_hz) * (target - self._opacity)
        self._t = tc
        return self._x / scale, self._opacity.copy(), tc
