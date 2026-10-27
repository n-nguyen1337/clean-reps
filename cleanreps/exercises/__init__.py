from .base import BODY_SIZES, Body, Cue, Exercise, ExerciseConfig, ExerciseUpdate, Phase, RepResult, Rule
from .curl import BicepCurl
from .pushup import PushUp
from .squat import Squat

EXERCISES: dict[str, type[Exercise]] = {cls.key: cls for cls in (Squat, PushUp, BicepCurl)}

__all__ = [
    "BODY_SIZES", "EXERCISES", "BicepCurl", "Body", "Cue", "Exercise", "ExerciseConfig", "ExerciseUpdate",
    "Phase", "PushUp", "RepResult", "Rule", "Squat",
]
