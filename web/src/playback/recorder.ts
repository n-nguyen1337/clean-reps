// Records the camera stream during a set with MediaRecorder, keeping the
// chunks in memory. Timed against the engine's clock so set times map onto
// video times.

import { pickMimeType, type Recording } from "./playback";

const BITS_PER_SECOND = 2_500_000; // about 19 MB a minute at 720p

export class SetRecorder {
  private chunks: Blob[] = [];
  private readonly startedAt: number;
  private stoppedAt: number | null = null;
  private failed = false;
  private readonly stopped: Promise<void>;
  private readonly timer: number;

  private constructor(private readonly rec: MediaRecorder, private readonly clockStart: number, capS: number) {
    rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    rec.onerror = () => { this.failed = true; };
    this.stopped = new Promise((resolve) => { rec.onstop = () => resolve(); });
    this.timer = window.setTimeout(() => this.halt(), capS * 1000);
    // Capture begins at this call; the start event can come seconds later on a cold encoder.
    this.startedAt = performance.now();
    rec.start(1000);
  }

  /**
   * Start recording `stream`. `clockStart` is the `performance.now()` the
   * engine's set time counts from. Null when the browser can't record.
   */
  static start(stream: MediaStream, clockStart: number, capS: number): SetRecorder | null {
    if (typeof MediaRecorder === "undefined") return null;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t)) ?? undefined;
    try {
      return new SetRecorder(new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITS_PER_SECOND }), clockStart, capS);
    } catch {
      return null;
    }
  }

  /** True while frames are going into the recording: not after the cap or an error. */
  get recording(): boolean {
    return this.stoppedAt === null && !this.failed;
  }

  private halt(): void {
    clearTimeout(this.timer);
    if (this.stoppedAt !== null) return;
    this.stoppedAt = performance.now();
    if (this.rec.state !== "inactive") this.rec.stop();
  }

  /** Stop (if the cap hasn't already) and return the recording, or null if nothing usable was recorded. */
  async stop(): Promise<Recording | null> {
    this.halt();
    // Some browsers never fire stop after an error; don't hang the Finish button.
    await Promise.race([this.stopped, new Promise((r) => setTimeout(r, 2000))]);
    if (this.failed || this.chunks.length === 0) return null;
    const mimeType = this.rec.mimeType || this.chunks[0].type;
    return {
      video: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      offsetS: (this.startedAt - this.clockStart) / 1000,
      endS: (this.stoppedAt! - this.clockStart) / 1000,
    };
  }

  /** Stop and drop the recording. */
  cancel(): void {
    this.halt();
    this.chunks = [];
  }
}
