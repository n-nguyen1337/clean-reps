"""One Euro filter for smoothing landmark jitter.

Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy
Input in Interactive Systems" (CHI 2012). Low cutoff when still (kills
jitter), higher cutoff when moving fast (keeps lag low).
"""

from __future__ import annotations

import math

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

    Tuned with ``tools/tune_skeleton.py``. It differs from a plain One Euro
    filter over the same coordinates in three ways:

    - One cutoff per joint, from its speed in 2D, so x and y lag alike and a
      joint's path keeps its shape.
    - A lead along the joint's velocity, faded in with speed. It takes back
      lag during a rep without adding shake when the person is still.
    - A one-frame hold on a jump too large to be movement. The model
      occasionally throws a joint and returns it on the next frame; a jump
      that's still there one frame later is accepted.

    Whether a joint is shown has hysteresis, so a joint near the confidence
    limit doesn't blink.

    Speeds and jumps are in pixels at a ``REFERENCE_LONG_SIDE`` frame, so a
    camera with another resolution behaves the same.
    """

    def __init__(self, min_cutoff: float = 1.5, beta: float = 0.015, d_cutoff: float = 2.0, lead: float = 0.5,
                 lead_speed: float = 450.0, jump: float = 80.0, show: float = 0.5, hide: float = 0.3):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.lead = lead
        self.lead_speed = lead_speed
        self.jump = jump
        self.show = show
        self.hide = hide
        self.reset()

    def reset(self) -> None:
        self._x: np.ndarray | None = None
        self._dx: np.ndarray | None = None
        self._far: np.ndarray | None = None
        self._shown: np.ndarray | None = None
        self._t = 0.0

    def __call__(self, xy: np.ndarray, visibility: np.ndarray, t: float,
                 long_side: float = REFERENCE_LONG_SIDE) -> tuple[np.ndarray, np.ndarray]:
        """Filter (n, 2) pixel positions. Returns the positions and which joints to show."""
        scale = REFERENCE_LONG_SIDE / long_side
        z = np.asarray(xy, float) * scale
        visibility = np.asarray(visibility, float)
        if self._x is None or self._x.shape != z.shape:
            self._x, self._dx = z.copy(), np.zeros_like(z)
            self._far = np.zeros(len(z), bool)
            self._shown = visibility >= self.show
            self._t = t
            return self._x / scale, self._shown.copy()

        dt = t - self._t
        if dt <= 0:
            return self._x / scale, self._shown.copy()

        speed = np.linalg.norm(self._dx, axis=1, keepdims=True)
        predicted = self._x + self.lead * np.minimum(speed / self.lead_speed, 1.0) * self._dx * dt

        # A stall between frames legitimately moves joints further.
        far = np.linalg.norm(z - predicted, axis=1) > self.jump * max(dt * 30.0, 1.0)
        z = np.where((far & ~self._far)[:, None], predicted, z)

        self._dx = self._dx + _alpha(dt, self.d_cutoff) * ((z - self._x) / dt - self._dx)
        cutoff = self.min_cutoff + self.beta * np.linalg.norm(self._dx, axis=1, keepdims=True)
        self._x = predicted + _alpha(dt, cutoff) * (z - predicted)
        self._far = far
        self._shown = np.where(self._shown, visibility >= self.hide, visibility >= self.show)
        self._t = t
        return self._x / scale, self._shown.copy()
