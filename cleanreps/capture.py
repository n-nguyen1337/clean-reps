"""Frame sources (webcam or video file) and raw-frame recording."""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np


class VideoSource:
    """Yields (frame, timestamp_seconds) from a webcam index or a video file.

    Webcam timestamps come from the wall clock; file timestamps come from the
    frame index, so replays are deterministic regardless of processing speed.
    """

    def __init__(self, source: int | str, mirror: bool | None = None,
                 width: int = 1280, height: int = 720):
        self.is_file = not isinstance(source, int)
        if self.is_file:
            if not Path(source).exists():
                raise FileNotFoundError(source)
            self._cap = cv2.VideoCapture(str(source))
        else:
            # DirectShow opens webcams much faster than the default backend on Windows.
            backend = cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else cv2.CAP_ANY
            self._cap = cv2.VideoCapture(source, backend)
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        if not self._cap.isOpened():
            raise RuntimeError(f"could not open video source {source!r}")

        # Mirror webcams by default so the preview behaves like a mirror.
        self.mirror = (not self.is_file) if mirror is None else mirror
        self.fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        self._index = 0
        self._start = time.monotonic()

    def read(self) -> tuple[np.ndarray, float] | None:
        ok, frame = self._cap.read()
        if not ok:
            return None
        if self.mirror:
            frame = cv2.flip(frame, 1)
        t = self._index / self.fps if self.is_file else time.monotonic() - self._start
        self._index += 1
        return frame, t

    def release(self) -> None:
        self._cap.release()

    def __enter__(self) -> VideoSource:
        return self

    def __exit__(self, *exc) -> None:
        self.release()


class Recorder:
    """Writes raw frames to an .mp4 so sessions can be replayed as test clips."""

    def __init__(self, path: str | Path, fps: float):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fps = fps
        self._writer: cv2.VideoWriter | None = None

    def write(self, frame: np.ndarray) -> None:
        if self._writer is None:
            h, w = frame.shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            self._writer = cv2.VideoWriter(str(self.path), fourcc, self._fps, (w, h))
        self._writer.write(frame)

    def release(self) -> None:
        if self._writer is not None:
            self._writer.release()
