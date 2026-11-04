import { useEffect, useRef, useState } from "react";
import { isClean, type Body, type Cue, type ExerciseUpdate, type RepResult } from "../engine/exercise";
import { createExercise } from "../engine/exercises";
import { CueManager, type Speaker } from "../engine/feedback";
import { SKELETON_SETTINGS } from "../engine/filters";
import { PoseSmoother, SkeletonSmoother } from "../engine/pose";
import { Session, type SessionRecord } from "../engine/session";
import { LandmarkLog } from "../playback/lab";
import { PoseTrack, RECORD_CAP_S, type Playback, type Recording } from "../playback/playback";
import { SetRecorder } from "../playback/recorder";
import { createLandmarker, toPoseFrame, type ModelVariant } from "../pose/landmarker";
import { cameraPermission, describeStartError, rememberCamera, type CameraError } from "../store/consent";
import { DelayedFrames } from "./delayedFrames";
import { CameraExplainer } from "./Disclaimer";
import { drawPose } from "./overlay";

interface Props {
  exercise: string;
  body: Body;
  model: ModelVariant;
  speaker: Speaker;
  /** Record the set for replay on the summary screen. */
  recordVideo: boolean;
  /** Lab mode: keep the skeleton data and frame timings so the summary can export them. */
  lab?: boolean;
  onDone: (record: SessionRecord, playback: Playback | null, lab: LabCapture | null) => void;
  /** Leave before the set started: the camera explainer's "Not now", or Back after an error. */
  onCancel: () => void;
  /** Set when the user leaves with the back button: end the set as if Finish was tapped. */
  finishNow?: boolean;
}

interface Hud {
  update: ExerciseUpdate | null;
  cue: Cue | null;
  lastRep: RepResult | null;
  fps: number;
}

/** What a lab-mode set hands the summary for export. The recording is kept even when replay is unusable. */
export interface LabCapture {
  log: LandmarkLog;
  recording: Recording | null;
}

type Status = { kind: "loading" } | { kind: "running" } | { kind: "error"; error: CameraError };

/** How long startup can take before the loading message says what it's waiting for. */
const SLOW_START_MS = 10_000;

/** Done once the video plays. iOS can leave play()'s promise unsettled, so the event counts too. */
function startVideo(video: HTMLVideoElement): Promise<unknown> {
  const failed = (err: unknown) => {
    throw new Error(`The video wouldn't start: ${err instanceof Error ? err.message : String(err)}`);
  };
  return Promise.race([
    video.play().catch(failed),
    new Promise((resolve) => video.addEventListener("playing", resolve, { once: true })),
  ]);
}

export function LiveSession({ exercise, body, model, speaker, recordVideo, lab, onDone, onCancel, finishNow }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef(new Session(exercise));
  const recorderRef = useRef<SetRecorder | null>(null);
  const posesRef = useRef(new PoseTrack());
  const labRef = useRef(lab ? new LandmarkLog(model, RECORD_CAP_S) : null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [finishing, setFinishing] = useState(false);
  const [hud, setHud] = useState<Hud>({ update: null, cue: null, lastRep: null, fps: 0 });
  const [showMetrics, setShowMetrics] = useState(false);
  // Counts each time the user settles into the start position; a new value replays the green blink.
  const [readyBlinks, setReadyBlinks] = useState(0);
  const config = useRef(createExercise(exercise, body).config).current;
  // "check" until we know whether the browser will prompt; "ask" shows the explainer first.
  const [camera, setCamera] = useState<"check" | "ask" | "go">("check");
  const [attempt, setAttempt] = useState(0);
  const [waitingOn, setWaitingOn] = useState("");

  useEffect(() => {
    let live = true;
    // When access is denied, start anyway: getUserMedia fails at once and the error says how to fix it.
    cameraPermission().then((p) => live && setCamera(p === "ask" ? "ask" : "go"));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (camera !== "go") return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let wakeLock: WakeLockSentinel | null = null;
    let frameHandle = 0;
    let landmarker: Awaited<ReturnType<typeof createLandmarker>> | null = null;

    // Name what startup is stuck on, instead of an endless "loading".
    const pending = new Set(["camera access", "the pose model"]);
    const track = <T,>(label: string, step: Promise<T>) => {
      pending.add(label);
      return step.finally(() => pending.delete(label));
    };
    const begun = performance.now();
    setWaitingOn("");
    const watchdog = setInterval(() => {
      if (performance.now() - begun > SLOW_START_MS) setWaitingOn([...pending].join(" and "));
    }, 1000);

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
        // mediaDevices is missing outside a secure context (plain http on a LAN address).
        if (!navigator.mediaDevices) throw new DOMException("Camera needs HTTPS", "SecurityError");
        [stream, landmarker] = await Promise.all([
          track("camera access", navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          })),
          track("the pose model", createLandmarker(model)),
        ]);
        rememberCamera();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          landmarker.close();
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await track("the video to start", startVideo(video));
      } catch (err) {
        clearInterval(watchdog);
        if (!cancelled) setStatus({ kind: "error", error: describeStartError(err) });
        return;
      }
      if (cancelled) return;
      clearInterval(watchdog);
      const video = videoRef.current!;
      await requestWakeLock();
      document.addEventListener("visibilitychange", onVisible);
      setStatus({ kind: "running" });

      const ex = createExercise(exercise, body);
      const smoother = new PoseSmoother();
      // What's drawn is smoothed with frames the engine hasn't waited for, so the two filters differ.
      const shownSmoother = new SkeletonSmoother();
      const cues = new CueManager(2, 4, speaker.say);
      const ctx = canvasRef.current!.getContext("2d")!;
      const picture = new DelayedFrames(frameRef.current!.getContext("2d", { alpha: false })!, SKELETON_SETTINGS.ahead);
      const start = performance.now();
      if (recordVideo) recorderRef.current = SetRecorder.start(stream, start, RECORD_CAP_S);
      let lastTs = -1, lastRep: RepResult | null = null, fps = 0, prev = start, wasReady = false;
      let lastPresented: number | null = null;

      const onFrame = (_: number, meta?: VideoFrameCallbackMetadata) => {
        if (cancelled || !landmarker) return;
        const now = performance.now();
        // VIDEO mode requires strictly increasing timestamps.
        const ts = Math.max(Math.round(now - start), lastTs + 1);
        lastTs = ts;
        const t = ts / 1000;

        const { videoWidth: w, videoHeight: h } = video;

        // Keep the frame the model is about to read, and put up the one from a few frames ago with
        // its pose below. The video keeps playing while the model runs, so drawing over the live
        // element would leave the skeleton behind the person, and the frames since smooth the pose.
        const copyStart = performance.now();
        picture.push(video, w, h);
        const detectStart = performance.now();
        const result = landmarker.detectForVideo(video, ts);
        const detectEnd = performance.now();
        const raw = toPoseFrame(result, w, h, ts);
        const pose = smoother.apply(raw);
        const update = ex.update(pose, t);
        sessionRef.current.sample(t, update.metrics);
        if (update.completed) {
          sessionRef.current.add(update.completed);
          lastRep = update.completed;
        }
        // Ready again after tracking was lost for long counts too: whoever came back has to settle again.
        if (update.ready && !wasReady) setReadyBlinks((n) => n + 1);
        wasReady = update.ready;
        cues.push(update.cues, t);
        const drawStart = performance.now();
        const shown = shownSmoother.apply(raw, ts, Math.max(w, h));
        if (shown) {
          if (recorderRef.current?.recording) posesRef.current.push(shown.timestampMs / 1000, shown.pose);
          drawPose(ctx, shown.pose, { width: w, height: h });
        }

        const presented = meta?.presentedFrames ?? null;
        labRef.current?.push(t, ts, raw, w, h, {
          copyMs: detectStart - copyStart,
          detectMs: detectEnd - detectStart,
          drawMs: performance.now() - drawStart,
          ageMs: meta?.captureTime === undefined ? null : now - meta.captureTime,
          dropped: presented === null || lastPresented === null ? null : Math.max(presented - lastPresented - 1, 0),
        });
        if (shown) labRef.current?.setShown(shown.timestampMs, shown.pose);
        lastPresented = presented;

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
      clearInterval(watchdog);
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
  }, [exercise, body, model, speaker, recordVideo, camera, attempt]);

  const finish = async () => {
    setFinishing(true);
    // Take the record now: frames keep arriving while the recorder stops.
    const s = sessionRef.current;
    const record: SessionRecord = { summary: s.summary(), reps: [...s.reps], trace: [...s.trace], config, body };
    const recording = await recorderRef.current?.stop() ?? null;
    const video = videoRef.current;
    onDone(record, recording && video
      ? { ...recording, width: video.videoWidth, height: video.videoHeight, poses: posesRef.current }
      : null,
      labRef.current && { log: labRef.current, recording });
  };

  useEffect(() => {
    if (finishNow && !finishing) finish();
  }, [finishNow]); // only the flag: finish() is recreated on every render

  const { update, cue, lastRep, fps } = hud;
  const faultNames = (rep: RepResult) => rep.faults
    .map((id) => id === "partial" ? "partial rep" : config.rules.find((r) => r.id === id)?.cue ?? id).join(", ");
  let verdict: { text: string; tone: string } | null = null;
  if (lastRep) {
    verdict = isClean(lastRep)
      ? { text: `Rep ${lastRep.index}: clean`, tone: "good" }
      : lastRep.counted
        ? { text: `Rep ${lastRep.index}: ${faultNames(lastRep)}`, tone: "warn" }
        : { text: `No rep: ${faultNames(lastRep)}`, tone: "bad" };
  }
  // What to do next, until the first rep has happened.
  let prompt: string | null = null;
  if (status.kind === "running" && update) {
    if (update.tracking && !update.ready) prompt = "Hold still in your start position";
    else if (update.reps === 0 && !lastRep) prompt = update.ready ? "Ready. Start your first rep" : "Get your whole body in frame";
  }

  if (camera === "ask") {
    return (
      <div className="live">
        <CameraExplainer hint={config.cameraHint} onContinue={() => setCamera("go")} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div className="live">
      <div className="stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={frameRef} />
        <canvas ref={canvasRef} />
      </div>
      {readyBlinks > 0 && <div key={readyBlinks} className="ready-blink" aria-hidden />}
      {update && !update.tracking && <span className="pill bad live-alert">Body not detected</span>}
      {showMetrics && update && (
        <span className="metrics">
          {fps.toFixed(0)} fps · {model} · {update.phase} · {Object.entries(update.metrics)
            .filter(([, v]) => v !== null && !Number.isNaN(v))
            .map(([k, v]) => `${k} ${v!.toFixed(1)}`).join(" · ")}
        </span>
      )}

      {status.kind === "loading" && camera === "go" && (
        <div className="overlay-msg">
          <p>Starting camera and loading the pose model…</p>
          <p className="hint">{config.cameraHint}</p>
          {waitingOn && <p className="hint">Still waiting for {waitingOn}.</p>}
        </div>
      )}
      {status.kind === "error" && (
        <div className="overlay-msg">
          <div className="sheet" role="alert">
            <h2>{status.error.title}</h2>
            <p className="lede">{status.error.help}</p>
            <div className="sheet-actions">
              <button className="ghost" onClick={onCancel}>Back</button>
              {status.error.retry && (
                <button className="primary" onClick={() => {
                  setStatus({ kind: "loading" });
                  setAttempt((a) => a + 1);
                }}>Try again</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="board" hidden={status.kind === "error" /* the error has its own Back */}>
        <div className="reps">
          <span className="reps-count">{update?.reps ?? 0}</span>
          <span className="reps-label">{config.name} reps</span>
        </div>
        <div className="message">
          {cue ? <p className={`cue ${cue.id === "good_rep" ? "good" : "warn"}${cue.text.length > 20 ? " long" : ""}`}>{cue.text}</p>
            : prompt ? <p className={`prompt${update?.ready ? " solo" : ""}`}><b>{prompt}</b>{!update?.ready && <span>{config.cameraHint}</span>}</p>
              : verdict && <p className={`verdict ${verdict.tone}${verdict.text.length > 20 ? " long" : ""}`}>{verdict.text}</p>}
        </div>
        <div className="controls">
          <button className="metrics-toggle" aria-pressed={showMetrics} onClick={() => setShowMetrics((s) => !s)}>Metrics</button>
          <button className="finish" disabled={finishing} onClick={finish}>Finish</button>
        </div>
      </div>
    </div>
  );
}
