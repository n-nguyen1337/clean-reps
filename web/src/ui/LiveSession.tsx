import { useEffect, useRef, useState } from "react";
import { isClean, type Body, type Cue, type ExerciseUpdate, type RepResult } from "../engine/exercise";
import { createExercise } from "../engine/exercises";
import { CueManager, type Speaker } from "../engine/feedback";
import { PoseSmoother } from "../engine/pose";
import { Session, type SessionRecord } from "../engine/session";
import { PoseTrack, RECORD_CAP_S, type Playback } from "../playback/playback";
import { SetRecorder } from "../playback/recorder";
import { createLandmarker, toPoseFrame, type ModelVariant } from "../pose/landmarker";
import { drawPose } from "./overlay";

interface Props {
  exercise: string;
  body: Body;
  model: ModelVariant;
  speaker: Speaker;
  /** Record the set for replay on the summary screen. */
  recordVideo: boolean;
  onDone: (record: SessionRecord, playback: Playback | null) => void;
  /** Set when the user leaves with the back button: end the set as if Finish was tapped. */
  finishNow?: boolean;
}

interface Hud {
  update: ExerciseUpdate | null;
  cue: Cue | null;
  lastRep: RepResult | null;
  fps: number;
}

type Status = { kind: "loading" } | { kind: "running" } | { kind: "error"; message: string };

export function LiveSession({ exercise, body, model, speaker, recordVideo, onDone, finishNow }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef(new Session(exercise));
  const recorderRef = useRef<SetRecorder | null>(null);
  const posesRef = useRef(new PoseTrack());
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [finishing, setFinishing] = useState(false);
  const [hud, setHud] = useState<Hud>({ update: null, cue: null, lastRep: null, fps: 0 });
  const [showMetrics, setShowMetrics] = useState(false);
  const config = useRef(createExercise(exercise, body).config).current;

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    let frameHandle = 0;
    let landmarker: Awaited<ReturnType<typeof createLandmarker>> | null = null;

    const requestWakeLock = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        /* not supported or denied: the screen may dim */
      }
    };
    const onVisible = () => document.visibilityState === "visible" && requestWakeLock();

    (async () => {
      try {
        [stream, landmarker] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
          createLandmarker(model),
        ]);
      } catch (err) {
        if (!cancelled) setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        landmarker.close();
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      await requestWakeLock();
      document.addEventListener("visibilitychange", onVisible);
      setStatus({ kind: "running" });

      const ex = createExercise(exercise, body);
      const smoother = new PoseSmoother();
      const cues = new CueManager(2, 4, speaker.say);
      const ctx = canvasRef.current!.getContext("2d")!;
      const start = performance.now();
      if (recordVideo) recorderRef.current = SetRecorder.start(stream, start, RECORD_CAP_S);
      let lastTs = -1, lastRep: RepResult | null = null, fps = 0, prev = start;

      const onFrame = () => {
        if (cancelled || !landmarker) return;
        const now = performance.now();
        // VIDEO mode requires strictly increasing timestamps.
        const ts = Math.max(Math.round(now - start), lastTs + 1);
        lastTs = ts;
        const t = ts / 1000;

        const { videoWidth: w, videoHeight: h } = video;
        if (ctx.canvas.width !== w || ctx.canvas.height !== h) Object.assign(ctx.canvas, { width: w, height: h });

        const pose = smoother.apply(toPoseFrame(landmarker.detectForVideo(video, ts), w, h, ts));
        const update = ex.update(pose, t);
        sessionRef.current.sample(t, update.metrics);
        if (update.completed) {
          sessionRef.current.add(update.completed);
          lastRep = update.completed;
        }
        cues.push(update.cues, t);
        if (recorderRef.current?.recording) posesRef.current.push(t, pose);
        drawPose(ctx, pose);

        fps = 0.9 * fps + 0.1 * (1000 / Math.max(now - prev, 1));
        prev = now;
        setHud({ update, cue: cues.current(t), lastRep, fps });
        schedule();
      };
      const schedule = () => {
        frameHandle = "requestVideoFrameCallback" in video
          ? video.requestVideoFrameCallback(onFrame)
          : requestAnimationFrame(onFrame);
      };
      schedule();
    })();

    return () => {
      cancelled = true;
      const video = videoRef.current;
      if (video && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(frameHandle);
      cancelAnimationFrame(frameHandle);
      document.removeEventListener("visibilitychange", onVisible);
      recorderRef.current?.cancel(); // no-op after Finish, which has already stopped it
      stream?.getTracks().forEach((t) => t.stop());
      wakeLock?.release().catch(() => {});
      landmarker?.close();
      speechSynthesis?.cancel();
    };
  }, [exercise, body, model, speaker, recordVideo]);

  const finish = async () => {
    setFinishing(true);
    // Take the record now: frames keep arriving while the recorder stops.
    const s = sessionRef.current;
    const record: SessionRecord = { summary: s.summary(), reps: [...s.reps], trace: [...s.trace], config, body };
    const recording = await recorderRef.current?.stop() ?? null;
    const video = videoRef.current;
    onDone(record, recording && video
      ? { ...recording, width: video.videoWidth, height: video.videoHeight, poses: posesRef.current }
      : null);
  };

  useEffect(() => {
    if (finishNow && !finishing) finish();
  }, [finishNow]); // only the flag: finish() is recreated on every render

  const { update, cue, lastRep, fps } = hud;
  let verdict: { text: string; tone: string } | null = null;
  if (lastRep) {
    verdict = isClean(lastRep)
      ? { text: `Rep ${lastRep.index}: clean`, tone: "good" }
      : lastRep.counted
        ? { text: `Rep ${lastRep.index}: ${lastRep.faults.join(", ")}`, tone: "warn" }
        : { text: `No rep: ${lastRep.faults.join(", ")}`, tone: "bad" };
  }

  return (
    <div className="live">
      <div className="stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      <div className="hud-top">
        <div className="reps">
          <span className="reps-count">{update?.reps ?? 0}</span>
          <span className="reps-label">{config.name} reps</span>
        </div>
        <div className="hud-right">
          {update && !update.tracking && <span className="pill bad">Body not detected</span>}
          <span className="pill">{fps.toFixed(0)} fps · {model}</span>
        </div>
      </div>

      {status.kind === "loading" && (
        <div className="overlay-msg">
          <p>Starting camera and loading the pose model…</p>
          <p className="hint">{config.cameraHint}</p>
        </div>
      )}
      {status.kind === "error" && (
        <div className="overlay-msg">
          <p>Couldn't start: {status.message}</p>
          <p className="hint">Allow camera access, then try again.</p>
        </div>
      )}
      {status.kind === "running" && update?.reps === 0 && !lastRep && (
        <p className="hint floating">{config.cameraHint}</p>
      )}

      {cue && <div className={`cue ${cue.id === "good_rep" ? "good" : "warn"}`}>{cue.text}</div>}

      <div className="hud-bottom">
        {verdict && <span className={`pill ${verdict.tone}`}>{verdict.text}</span>}
        {showMetrics && update && (
          <span className="metrics">
            {update.phase} · {Object.entries(update.metrics)
              .filter(([, v]) => v !== null && !Number.isNaN(v))
              .map(([k, v]) => `${k} ${v!.toFixed(1)}`).join(" · ")}
          </span>
        )}
        <div className="controls">
          <button className="ghost" onClick={() => setShowMetrics((s) => !s)}>{showMetrics ? "Hide" : "Show"} metrics</button>
          <button className="primary" disabled={finishing} onClick={finish}>Finish</button>
        </div>
      </div>
    </div>
  );
}
