"""Score and compare smoothing settings for the drawn skeleton on recorded clips.

    python tools/tune_skeleton.py                                 # every clip in tests/clips
    python tools/tune_skeleton.py ~/Downloads/20261104-*.lab.json # phone exports
    python tools/tune_skeleton.py --beta 0.02 --lead 0.75         # try other settings
    python tools/tune_skeleton.py --sweep --pick 0,1,2            # compare a grid on some clips
    python tools/tune_skeleton.py clip.lab.json --timing          # how the device kept up
    python tools/tune_skeleton.py clip.lab.json --skew            # pose time stamps vs the video
    python tools/tune_skeleton.py clip.lab.json --render out.mp4  # old filter | new filter, side by side

Scores cover the frames where the person is in position, and only joints on
screen, since walking to and from the phone would otherwise dominate them.
They're measured against a zero-phase low-pass of the raw landmarks: a stand-in
for the true path, which a live filter can't compute because it needs later frames.

- lag: how far the skeleton trails during movement, in ms
- still: frame-to-frame shake while the joint is still, in pixels
- moving: frame-to-frame shake while the joint moves, in pixels
- hops: joint-frames per 1000 with shake above 12 pixels

Lag, still and moving are given for shoulders and hips, then limbs. Pixels are
at the clip's own resolution. At squat speed (about 450 px/s at 720p) 10 ms of
lag is 4.5 pixels.
"""

from __future__ import annotations

import argparse
import itertools
import math
import statistics
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from cleanreps.filters import OneEuroFilter, SkeletonFilter
from cleanreps.labels import read_json
from cleanreps.landmarks import SKELETON

DEFAULT_CLIPS = Path("tests/clips")
TORSO = [11, 12, 23, 24]
LIMBS = [13, 14, 15, 16, 25, 26, 27, 28]
BODY = TORSO + LIMBS
HIPS = [23, 24]
LEGS = [(25, 27), (26, 28)]
MOVING = 100.0  # px/s
STILL = 25.0
HOP = 12.0
REFERENCE_HZ = 6.0  # squats stay well below this
SETTINGS = ("min_cutoff", "beta", "d_cutoff", "lead", "lead_speed", "jump")
#: The filter the overlay used before SkeletonFilter, and the engine's, for comparison.
OLD = (1.5, 0.2, 1.0)
ENGINE = (1.5, 0.01, 1.0)
#: Keep in step with POSE_STAMP_LAG_S in web/src/playback/playback.ts.
POSE_STAMP_LAG_S = 0.018


@dataclass
class Clip:
    path: Path
    meta: dict
    frames: list[dict]  # every frame, with or without a pose
    t: np.ndarray  # frames with a pose, from here on
    xy: np.ndarray  # (frames, 33, 2)
    vis: np.ndarray

    @property
    def name(self) -> str:
        return self.path.name.split(".")[0]

    @property
    def long_side(self) -> float:
        return float(max(self.meta["width"], self.meta["height"]))


def load_clip(path: Path) -> Clip:
    data = read_json(path)
    frames = data.pop("frames")
    posed = [f for f in frames if f["pose"]]
    return Clip(path, data, frames, np.array([f["t"] for f in posed]),
                np.array([f["pose"]["image"] for f in posed])[:, :, :2],
                np.array([f["pose"]["visibility"] for f in posed]))


def apply_one_euro(clip: Clip, min_cutoff: float, beta: float, d_cutoff: float) -> np.ndarray:
    f = OneEuroFilter(min_cutoff, beta, d_cutoff)
    return np.array([f(x, t) for x, t in zip(clip.xy, clip.t)])


def apply_skeleton(clip: Clip, **settings) -> np.ndarray:
    f = SkeletonFilter(**settings)
    return np.array([f(x, v, t, clip.long_side)[0] for x, v, t in zip(clip.xy, clip.vis, clip.t)])


def reference(clip: Clip) -> np.ndarray:
    """A median of 5, then a forward-backward low-pass.

    It has to ignore thrown joints. A reference that follows one marks the
    frames around it as movement, so the throw never counts against "still".
    """
    xy = clip.xy.copy()
    xy[2:-2] = np.median(np.stack([clip.xy[i:len(clip.xy) - 4 + i] for i in range(5)]), axis=0)
    dt = float(np.median(np.diff(clip.t)))
    a = 1.0 / (1.0 + 1.0 / (2.0 * math.pi * REFERENCE_HZ) / dt)

    def forward(x: np.ndarray) -> np.ndarray:
        y = x.copy()
        for _ in range(2):
            for i in range(1, len(y)):
                y[i] = y[i - 1] + a * (y[i] - y[i - 1])
        return y

    return forward(forward(xy)[::-1])[::-1]


def in_position(clip: Clip) -> np.ndarray:
    """Which joints count on each frame: on screen and visible, while the body is in frame."""
    w, h = clip.meta["width"], clip.meta["height"]
    x, y = clip.xy[:, :, 0], clip.xy[:, :, 1]
    on = (x >= 0) & (x < w) & (y >= 0) & (y < h) & (clip.vis >= 0.5)
    whole = on[:, HIPS].any(axis=1) & np.any([on[:, a] & on[:, b] for a, b in LEGS], axis=0)
    settled = np.convolve(whole.astype(float), np.ones(31) / 31, "same") > 0.97  # skips the edges of a walk-off
    return on & settled[:, None]


def score(clip: Clip, shown: np.ndarray) -> dict[str, float]:
    ref = reference(clip)
    mask = in_position(clip)
    vel = np.gradient(ref, clip.t, axis=0)
    speed = np.linalg.norm(vel, axis=2)
    err = ref - shown
    shake = np.linalg.norm(np.diff(err, axis=0), axis=2)
    both = mask[1:] & mask[:-1]
    out: dict[str, float] = {}
    for label, joints in (("torso", TORSO), ("limbs", LIMBS)):
        moving = (speed[:, joints] > MOVING) & mask[:, joints]
        v, e = vel[:, joints], err[:, joints]
        out[f"lag_{label}"] = float((e * v).sum(axis=2)[moving].sum() / (v * v).sum(axis=2)[moving].sum() * 1000)
        s, sp, ok = shake[:, joints], speed[1:, joints], both[:, joints]
        out[f"still_{label}"] = float(np.sqrt((s[(sp < STILL) & ok] ** 2).mean()))
        out[f"moving_{label}"] = float(np.sqrt((s[(sp > MOVING) & ok] ** 2).mean()))
    out["hops"] = float(((shake[:, BODY] > HOP) & both[:, BODY]).sum() / both[:, BODY].sum() * 1000)
    return out


def row(name: str, scores: list[dict[str, float]]) -> str:
    m = {k: statistics.fmean(s[k] for s in scores) for k in scores[0]}
    return (f"{name:<40} lag {m['lag_torso']:3.0f} {m['lag_limbs']:3.0f} ms | still {m['still_torso']:.2f} {m['still_limbs']:.2f}"
            f" | moving {m['moving_torso']:.2f} {m['moving_limbs']:5.2f} | hops {m['hops']:4.1f}")


def compare(clips: list[Clip], settings: dict[str, float], sweep: bool) -> None:
    print(f"{len(clips)} clip(s). Shoulders and hips first, then limbs.")
    print(row("raw", [score(c, c.xy) for c in clips]))
    print(row(f"engine One Euro {ENGINE}", [score(c, apply_one_euro(c, *ENGINE)) for c in clips]))
    print(row(f"old overlay One Euro {OLD}", [score(c, apply_one_euro(c, *OLD)) for c in clips]))
    print(row(f"SkeletonFilter {settings or 'defaults'}", [score(c, apply_skeleton(c, **settings)) for c in clips]))
    if sweep:
        grid = itertools.product((0.005, 0.01, 0.02), (1.0, 2.0), (0.0, 0.5, 0.75), (50.0, 60.0, 80.0))
        for beta, d_cutoff, lead, jump in grid:
            s = {**settings, "beta": beta, "d_cutoff": d_cutoff, "lead": lead, "jump": jump}
            print(row(f"beta {beta} dc {d_cutoff} lead {lead} jump {jump:.0f}", [score(c, apply_skeleton(c, **s)) for c in clips]))


def blinks(clip: Clip) -> tuple[float, float]:
    """Joints appearing or disappearing per 1000 joint-frames: at a hard limit of 0.5, then with SkeletonFilter's hysteresis."""
    f = SkeletonFilter()
    shown = np.array([f(x, v, t, clip.long_side)[1] for x, v, t in zip(clip.xy, clip.vis, clip.t)])[:, BODY]
    hard = (clip.vis >= 0.5)[:, BODY]
    return float((hard[1:] != hard[:-1]).mean() * 1000), float((shown[1:] != shown[:-1]).mean() * 1000)


def timing(clip: Clip) -> None:
    """What the export's per-frame timings say about keeping up. Clips exported before they existed have none."""
    ts = np.array([f["ts"] for f in clip.frames], float)
    print(clip.name)
    print(f"  {len(ts)} frames, {1000 / np.median(np.diff(ts)):.1f} fps, slowest gaps {np.sort(np.diff(ts))[-3:].round()} ms")
    for key, what in (("copy_ms", "frame copy"), ("detect_ms", "model"), ("age_ms", "camera to callback")):
        v = np.array([f[key] for f in clip.frames if f.get(key) is not None])
        print(f"  {what}: " + (f"median {np.median(v):.1f} ms, p95 {np.percentile(v, 95):.1f} ms" if len(v) else "not recorded"))
    dropped = [f["dropped"] for f in clip.frames if f.get("dropped") is not None]
    print(f"  camera frames dropped: {sum(dropped) if dropped else 'not recorded'}")


def video_of(clip: Clip) -> Path:
    file = (clip.meta.get("video") or {}).get("file")
    candidates = ([clip.path.with_name(file)] if file else []) + [clip.path.with_name(f"{clip.name}{e}") for e in (".mp4", ".webm")]
    for path in candidates:
        if path.exists():
            return path
    raise SystemExit(f"{clip.name}: no video next to the clip")


def align_offset(clip: Clip, duration: float) -> float:
    """Set time at video time 0. Mirrors alignOffset() in web/src/playback/playback.ts."""
    video = clip.meta.get("video") or {}
    if "endS" not in video:
        return 0.0
    offset = video["endS"] - duration
    return max(offset, 0.0) if -0.5 < offset <= video["endS"] else video["offsetS"]


def skew(clip: Clip, model: Path) -> None:
    """How late a pose's time stamp is against its picture, found by running the model over the video."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    cap = cv2.VideoCapture(str(video_of(clip)))
    options = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(model)),
                                           running_mode=vision.RunningMode.VIDEO, num_poses=1)
    times, poses, last = [], [], -1
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            last = max(int(ms), last + 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), last)
            if result.pose_landmarks:
                times.append(ms / 1000)
                poses.append([p.y * frame.shape[0] for p in result.pose_landmarks[0]])
    cap.release()
    times, poses = np.array(times), np.array(poses)
    offset = align_offset(clip, times[-1] + float(np.median(np.diff(times))))

    best = []
    for joint in TORSO:
        def error(d: float) -> float:
            q = clip.t - offset - d
            m = (q > times[0]) & (q < times[-1])
            return float(np.mean((clip.xy[m, joint, 1] - np.interp(q[m], times, poses[:, joint])) ** 2))
        best.append(float(min(np.arange(-0.3, 0.3, 0.002), key=error)) * 1000)
    print(f"{clip.name}: poses stamped {statistics.median(best):+.0f} ms from their pictures "
          f"({' '.join(f'{b:+.0f}' for b in best)}); the replay assumes {POSE_STAMP_LAG_S * 1000:+.0f} ms")


def render(clip: Clip, out: Path) -> None:
    """The set's video with the old overlay filter on the left and SkeletonFilter on the right."""
    old, new = apply_one_euro(clip, *OLD), apply_skeleton(clip)
    cap = cv2.VideoCapture(str(video_of(clip)))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    offset = align_offset(clip, cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps)
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w * 2, h))

    def draw(image: np.ndarray, xy: np.ndarray, vis: np.ndarray, label: str) -> None:
        for a, b in SKELETON:
            if vis[a] >= 0.5 and vis[b] >= 0.5:
                cv2.line(image, tuple(map(int, xy[a])), tuple(map(int, xy[b])), (236, 241, 238), 5, cv2.LINE_AA)
        for i in BODY:
            if vis[i] >= 0.5:
                cv2.circle(image, tuple(map(int, xy[i])), 8, (120, 220, 178), -1, cv2.LINE_AA)
        cv2.putText(image, label, (24, 56), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3, cv2.LINE_AA)

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # The pose taken from this picture, as the replay finds it.
        i = int(np.clip(np.searchsorted(clip.t, n / fps + offset + POSE_STAMP_LAG_S), 0, len(clip.t) - 1))
        left = frame.copy()
        draw(left, old[i], clip.vis[i], "old")
        draw(frame, new[i], clip.vis[i], "new")
        writer.write(np.hstack([left, frame]))
        n += 1
    cap.release()
    writer.release()
    print(f"{out}: {n} frames, old filter on the left, SkeletonFilter on the right")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("clips", nargs="*", type=Path, help="*.lab.json or *.landmarks.json.gz (default: tests/clips)")
    p.add_argument("--pick", help="only these clips, as comma-separated indexes")
    p.add_argument("--sweep", action="store_true", help="also score a grid of settings")
    p.add_argument("--timing", action="store_true", help="print the export's frame timings")
    p.add_argument("--skew", action="store_true", help="measure the pose time stamps against the video")
    p.add_argument("--render", type=Path, help="write a side-by-side video (one clip)")
    p.add_argument("--model", type=Path, default=Path("web/public/models/pose_landmarker_lite.task"), help="for --skew")
    for name in SETTINGS:
        p.add_argument(f"--{name.replace('_', '-')}", type=float)
    args = p.parse_args(argv)

    paths = args.clips or sorted(DEFAULT_CLIPS.glob("*.landmarks.json.gz"))
    if not paths:
        p.error(f"no clips in {DEFAULT_CLIPS}")
    clips = [load_clip(path) for path in paths]
    if args.pick:
        clips = [clips[int(i)] for i in args.pick.split(",")]

    if args.render:
        if len(clips) != 1:
            p.error("--render takes one clip")
        render(clips[0], args.render)
    elif args.timing or args.skew:
        for clip in clips:
            if args.timing:
                timing(clip)
            if args.skew:
                skew(clip, args.model)
    else:
        settings = {k: v for k in SETTINGS if (v := getattr(args, k)) is not None}
        compare(clips, settings, args.sweep)
        pairs = [blinks(c) for c in clips]
        print(f"Joints blinking per 1000 joint-frames: {statistics.fmean(a for a, _ in pairs):.2f} at a hard limit, "
              f"{statistics.fmean(b for _, b in pairs):.2f} with hysteresis")


if __name__ == "__main__":
    main()
