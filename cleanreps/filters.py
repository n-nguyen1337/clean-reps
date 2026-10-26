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
