"""Command-line entry point: ``python -m cleanreps --exercise squat``."""

from __future__ import annotations

import argparse
import time
from datetime import datetime

import cv2

from .capture import Recorder, VideoSource
from .exercises import EXERCISES
from .feedback import CueManager, Speaker
from .pipeline import Pipeline, replay
from .pose import MODEL_VARIANTS
from .session import Session
from .ui import draw_hud, draw_pose

WINDOW = "cleanReps"


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="cleanreps", description="Real-time exercise form feedback.")
    p.add_argument("-e", "--exercise", choices=sorted(EXERCISES), default="squat")
    p.add_argument("-s", "--source", default="0", help="webcam index or video file path")
    p.add_argument("-m", "--model", choices=MODEL_VARIANTS, default="full")
    p.add_argument("--no-audio", action="store_true", help="disable spoken cues")
    p.add_argument("--no-mirror", action="store_true", help="don't mirror the webcam preview")
    p.add_argument("--record", nargs="?", const="auto", metavar="PATH",
                   help="save raw frames to an .mp4 for replay/testing")
    p.add_argument("--headless", action="store_true",
                   help="replay a video file with no window and print the summary")
    p.add_argument("--web", action="store_true",
                   help="open a browser viewer to analyze and replay clips in --video-dir")
    p.add_argument("--export-site", metavar="DIR",
                   help="pre-render --clips (as -e) into a static site, e.g. for GitHub Pages")
    p.add_argument("--clips", nargs="+", metavar="VIDEO", help="video files for --export-site")
    p.add_argument("--video-dir", default="vids", help="folder of clips for --web")
    p.add_argument("--port", type=int, default=8000, help="port for --web")
    return p.parse_args(argv)


def run_live(args: argparse.Namespace) -> Session:
    source_arg = int(args.source) if args.source.isdigit() else args.source
    source = VideoSource(source_arg, mirror=False if args.no_mirror else None)
    pipe = Pipeline(args.exercise, args.model)
    speaker = None if args.no_audio else Speaker()
    cues = CueManager(speaker=speaker)
    session = Session(args.exercise)

    recorder = None
    if args.record:
        path = args.record if args.record != "auto" else (
            f"recordings/{datetime.now():%Y%m%d-%H%M%S}-{args.exercise}.mp4")
        recorder = Recorder(path, source.fps)

    print(f"{pipe.exercise.config.name}: {pipe.exercise.config.camera_hint}")
    print("Keys: q/Esc quit, r reset reps")

    last_rep, fps, prev = None, 0.0, time.monotonic()
    try:
        while (item := source.read()) is not None:
            frame, t = item
            if recorder is not None:
                recorder.write(frame)

            pose, update = pipe.process(frame, t)
            if update.completed is not None:
                session.add(update.completed)
                last_rep = update.completed
            cues.push(update.cues, t)

            now = time.monotonic()
            fps = 0.9 * fps + 0.1 / max(now - prev, 1e-6)
            prev = now

            if pose is not None:
                draw_pose(frame, pose)
            draw_hud(frame, pipe.exercise.config, update, cues.current(t), last_rep, fps)
            cv2.imshow(WINDOW, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27) or cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                break
            if key == ord("r"):
                pipe.exercise.reset()
                session, last_rep = Session(args.exercise), None
    finally:
        source.release()
        pipe.close()
        if recorder is not None:
            recorder.release()
            print(f"Recording saved to {recorder.path}")
        if speaker is not None:
            speaker.close()
        cv2.destroyAllWindows()
    return session


def main(argv=None) -> None:
    args = parse_args(argv)
    if args.web:
        from .web import serve
        serve(args.video_dir, args.model, args.port)
        return
    if args.export_site:
        from .web import export_site
        if not args.clips:
            raise SystemExit("--export-site needs --clips VIDEO [VIDEO ...]")
        print(f"Site written to {export_site(args.export_site, args.clips, [args.exercise], args.model)}")
        return
    if args.headless:
        if args.source.isdigit():
            raise SystemExit("--headless needs a video file as --source")
        session = replay(args.source, args.exercise, args.model)
    else:
        session = run_live(args)

    print(session.format_summary())
    if session.reps:
        print(f"Session saved to {session.save()}")


if __name__ == "__main__":
    main()
