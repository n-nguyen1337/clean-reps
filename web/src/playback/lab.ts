// Lab capture for tuning thresholds (PLAN-tuning.md) and the skeleton's smoothing
// (tools/tune_skeleton.py): with lab mode on, a set keeps its raw landmarks, what
// was drawn and how long each frame took, and the summary can export them with the
// video and the engine's verdicts as draft labels. Turn on with ?lab=1, off with ?lab=0.

import type { Body, RepResult } from "../engine/exercise";
import { SKELETON_SETTINGS } from "../engine/filters";
import type { PoseFrame } from "../engine/pose";
import type { ModelVariant } from "../pose/landmarker";
import type { Recording } from "./playback";

const KEY = "cleanreps.lab";
const DECIMALS = 1e6; // as in tools/export_fixtures.py

/** On from ?lab=1 until ?lab=0, remembered so it survives a home-screen launch that drops the query. */
export function labEnabled(search = location.search): boolean {
  const param = new URLSearchParams(search).get("lab");
  try {
    if (param === "1") localStorage.setItem(KEY, "on");
    if (param === "0") localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === "on";
  } catch {
    return param === "1";
  }
}

/** How a frame went, to tell a slow device from a laggy filter. */
export interface FrameTiming {
  /** Copying the camera frame to the canvas. */
  copyMs: number;
  /** Running the pose model. */
  detectMs: number;
  /** From camera capture to this frame's callback, where the browser reports it. */
  ageMs: number | null;
  /** Camera frames skipped since the last processed one, where the browser reports it. */
  dropped: number | null;
}

interface Frame {
  t: number;
  ts: number;
  pose: PoseFrame | null;
  shown?: PoseFrame | null;
  timing?: FrameTiming;
}

/** The raw (unsmoothed) pose of every processed frame, as the model returned it, with what was drawn for it. */
export class LandmarkLog {
  readonly frames: Frame[] = [];
  width = 0;
  height = 0;

  constructor(readonly model: ModelVariant, private readonly capS: number) {}

  push(t: number, ts: number, pose: PoseFrame | null, width: number, height: number,
    drawn?: { shown: PoseFrame | null; timing: FrameTiming }): void {
    if (t > this.capS) return;
    [this.width, this.height] = [width, height];
    this.frames.push({ t, ts, pose, ...drawn });
  }
}

const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : null;

/** The set's frame timings at a glance. Null when nothing was recorded. */
export function labTimings(log: LandmarkLog) {
  const timings = log.frames.flatMap((f) => f.timing ?? []);
  return {
    copyMs: median(timings.map((f) => f.copyMs)),
    detectMs: median(timings.map((f) => f.detectMs)),
    dropped: timings.some((f) => f.dropped !== null) ? timings.reduce((sum, f) => sum + (f.dropped ?? 0), 0) : null,
  };
}

const round = (v: number) => Math.round(v * DECIMALS) / DECIMALS;
const rows = (flat: Float64Array) => Array.from({ length: flat.length / 3 }, (_, i) =>
  [round(flat[i * 3]), round(flat[i * 3 + 1]), round(flat[i * 3 + 2])]);
const tenth = (v: number) => Math.round(v * 10) / 10;
const cents = (v: number) => Math.round(v * 100) / 100;
/** As drawn: [x, y, shown] per joint, in fewer digits since it's only ever looked at. */
const shownRows = (pose: PoseFrame) => Array.from({ length: pose.visibility.length }, (_, i) =>
  [cents(pose.image[i * 3]), cents(pose.image[i * 3 + 1]), pose.visibility[i]]);

/**
 * The export's JSON. `frames` uses the parity fixture layout, so the Python
 * tools can replay it, plus what was drawn and the frame's timings. `labels`
 * is the engine's verdict per rep, to be corrected by hand into the clip's
 * label sidecar.
 */
export function labExport({ exercise, body, reps, log, recording, videoFile, now = new Date() }: {
  exercise: string; body: Body; reps: RepResult[]; log: LandmarkLog;
  recording: Recording | null; videoFile: string | null; now?: Date;
}) {
  return {
    format: "cleanreps-lab/1",
    exercise,
    recorded: now.toISOString(),
    app: __APP_VERSION__,
    userAgent: navigator.userAgent,
    model: log.model,
    body,
    width: log.width,
    height: log.height,
    overlay: SKELETON_SETTINGS,
    // Set time at video time 0 is about offsetS; endS minus the video's duration is more exact.
    video: recording && videoFile && { file: videoFile, mimeType: recording.mimeType, offsetS: recording.offsetS, endS: recording.endS },
    labels: {
      draft: true,
      exercise,
      person: null,
      split: null,
      reps: reps.map((r) => ({ bottom_s: round(r.bottomS), counted: r.counted, faults: [...r.faults] })),
    },
    engine: reps.map((r) => ({ counted: r.counted, index: r.index, start_s: r.startS, bottom_s: r.bottomS,
      end_s: r.endS, faults: r.faults, extremes: r.extremes })),
    frames: log.frames.map(({ t, ts, pose, shown, timing }) => ({
      t, ts,
      pose: pose && { image: rows(pose.image), world: rows(pose.world), visibility: Array.from(pose.visibility, round) },
      ...(shown && { shown: shownRows(shown) }),
      ...(timing && {
        copy_ms: tenth(timing.copyMs), detect_ms: tenth(timing.detectMs),
        age_ms: timing.ageMs === null ? null : tenth(timing.ageMs), dropped: timing.dropped,
      }),
    })),
  };
}

/** `20261028-143005-squat`, like the Python recorder's file names. */
export function clipName(exercise: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${exercise}`;
}

const extension = (mimeType: string) => mimeType.includes("mp4") ? "mp4" : "webm";

/** Build the files for a set: its video (if recorded) and the landmark JSON. */
export function labFiles(args: Omit<Parameters<typeof labExport>[0], "videoFile">): File[] {
  const name = clipName(args.exercise, args.now);
  const rec = args.recording;
  const videoFile = rec && `${name}.${extension(rec.mimeType)}`;
  const json = JSON.stringify(labExport({ ...args, videoFile }));
  const files = [new File([json], `${name}.lab.json`, { type: "application/json" })];
  if (rec && videoFile) files.unshift(new File([rec.video], videoFile, { type: rec.mimeType }));
  return files;
}

/**
 * Hand the files to the share sheet where it takes files (phones: save to
 * Files, AirDrop, Drive), otherwise download them one by one.
 */
export async function saveFiles(files: File[]): Promise<"shared" | "downloaded" | "cancelled"> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Some browsers refuse large or video files: fall back to downloads.
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    await new Promise((r) => setTimeout(r, 300)); // back-to-back downloads get dropped
  }
  return "downloaded";
}
