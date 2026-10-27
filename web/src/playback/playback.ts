// Set replay: the recorded video plus the poses the engine saw while it ran.
// Lives in memory for the summary screen only; never stored or synced.
// Times here are set times (engine `t`, seconds from the start of the set)
// unless named as video times.

import type { RepRow } from "../engine/analysis";
import { NUM_LANDMARKS, type PoseFrame } from "../engine/pose";
import type { TracePoint } from "../engine/session";

/** Recording stops after this long; the analysis keeps running. */
export const RECORD_CAP_S = 4 * 60;

export interface Recording {
  video: Blob;
  mimeType: string;
  /** Set time at video time 0, as estimated when recording started. The player refines it with alignOffset(). */
  offsetS: number;
  /** Set time when recording stopped. */
  endS: number;
}

export interface Playback extends Recording {
  /** Pixel size the poses were measured in: the camera's frame size. */
  width: number;
  height: number;
  poses: PoseTrack;
}

// MP4 first: MediaRecorder's WebM has no duration, which makes seeking unreliable.
const MIME_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return MIME_TYPES.find(isSupported) ?? null;
}

const STRIDE = NUM_LANDMARKS * 3; // x, y, visibility

/** Read-only pose for drawing: image coordinates and visibility only. */
export class PoseView {
  constructor(private readonly data: Float32Array) {}

  img(i: number): Float32Array { return this.data.subarray(i * 3, i * 3 + 2); }

  visible(...ids: number[]): boolean {
    return ids.every((i) => this.data[i * 3 + 2] >= 0.5);
  }
}

/** Every processed frame's pose, packed into growable typed arrays (about 12 KB a second at 30 fps). */
export class PoseTrack {
  private times = new Float64Array(1024);
  private data = new Float32Array(1024 * STRIDE);
  length = 0;

  /** Add a frame at set time `t`. A null pose is kept as a gap, so nothing is drawn for it. */
  push(t: number, pose: PoseFrame | null): void {
    if (this.length === this.times.length) {
      const times = new Float64Array(this.times.length * 2);
      const data = new Float32Array(this.data.length * 2);
      times.set(this.times);
      data.set(this.data);
      [this.times, this.data] = [times, data];
    }
    const o = this.length * STRIDE;
    if (pose) {
      for (let i = 0; i < NUM_LANDMARKS; i++) {
        const [x, y] = pose.img(i);
        this.data.set([x, y, pose.visibility[i]], o + i * 3);
      }
    } else {
      this.data.fill(0, o, o + STRIDE);
    }
    this.times[this.length++] = t;
  }

  /** The latest frame at or before `t`, or null if there is none within `maxGapS`. */
  at(t: number, maxGapS = 0.25): PoseView | null {
    let lo = 0, hi = this.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found < 0 || t - this.times[found] > maxGapS) return null;
    return new PoseView(this.data.subarray(found * STRIDE, (found + 1) * STRIDE));
  }
}

/**
 * Set time at video time 0, anchored on the end of the recording: stopping
 * happens at a known set time, while the start can lag. Falls back to the
 * start estimate when the duration is unknown or doesn't fit.
 */
export function alignOffset(rec: Pick<Recording, "offsetS" | "endS">, videoDurationS: number): number {
  const offset = rec.endS - videoDurationS;
  // A little slack for the last frame landing just after the stop time.
  return Number.isFinite(offset) && offset > -0.5 && offset <= rec.endS ? Math.max(offset, 0) : rec.offsetS;
}

/** The rep in progress at `t`, if any. */
export function repAt(rows: RepRow[], t: number): RepRow | null {
  return rows.find((r) => t >= r.rep.startS && t <= r.rep.endS) ?? null;
}

/** The trace's value of `metric` nearest to `t`, if a sample is within `maxGapS`. */
export function traceValueAt(trace: TracePoint[], metric: string, t: number, maxGapS = 0.15): number | null {
  let lo = 0, hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const near = [trace[lo - 1], trace[lo]].filter((p) => p && Math.abs(p.t - t) <= maxGapS)
    .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  const v = near?.metrics[metric];
  return v === undefined || v === null || Number.isNaN(v) ? null : v;
}
