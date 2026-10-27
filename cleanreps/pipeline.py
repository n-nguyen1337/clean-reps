"""Frame-to-feedback pipeline shared by the live app and offline replay."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .capture import VideoSource
from .exercises import EXERCISES, Body, Exercise, ExerciseUpdate
from .pose import PoseEstimator, PoseFrame, PoseSmoother
from .session import Session


class Pipeline:
    def __init__(self, exercise: str | Exercise, model: str = "full", body: Body | None = None):
        self.exercise = EXERCISES[exercise](body=body) if isinstance(exercise, str) else exercise
        self.estimator = PoseEstimator(model)
        self.smoother = PoseSmoother()

    def process(self, frame: np.ndarray, t: float) -> tuple[PoseFrame | None, ExerciseUpdate]:
        pose = self.smoother(self.estimator.process(frame, int(t * 1000)))
        return pose, self.exercise.update(pose, t)

    def close(self) -> None:
        self.estimator.close()

    def __enter__(self) -> Pipeline:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def replay(path: str | Path, exercise: str, model: str = "full", body: Body | None = None) -> Session:
    """Run a recorded clip through the pipeline without a window."""
    session = Session(exercise)
    with VideoSource(str(path), mirror=False) as source, Pipeline(exercise, model, body) as pipe:
        while (item := source.read()) is not None:
            _, update = pipe.process(*item)
            if update.completed is not None:
                session.add(update.completed)
    return session
