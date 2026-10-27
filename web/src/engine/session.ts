// Collects rep results into a session summary (port of cleanreps/session.py).
// The web app also keeps a downsampled metric trace for the summary charts.

import type { Body, ExerciseConfig, Metrics, RepResult } from "./exercise";

export interface SessionSummary {
  exercise: string;
  started: string;
  reps: number;
  cleanReps: number;
  partialReps: number;
  faults: Record<string, number>;
  avgDownS: number | null;
  avgUpS: number | null;
}

/** Everything the summary screen needs about a finished set. */
export interface SessionRecord {
  summary: SessionSummary;
  reps: RepResult[];
  trace: TracePoint[];
  config: ExerciseConfig; // with limits already adjusted for `body`
  body: Body;
}

export interface TracePoint {
  t: number;
  metrics: Metrics;
}

/** Trace samples per second; plenty for charts, small enough to keep a long set in memory. */
export const TRACE_HZ = 10;

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export class Session {
  readonly started = new Date();
  readonly reps: RepResult[] = [];
  readonly trace: TracePoint[] = [];

  constructor(readonly exercise: string) {}

  add(rep: RepResult): void {
    this.reps.push(rep);
  }

  /** Record a frame's metrics, keeping at most TRACE_HZ samples per second. */
  sample(t: number, metrics: Metrics): void {
    const last = this.trace[this.trace.length - 1];
    if (last && t - last.t < 1 / TRACE_HZ - 1e-3) return; // tolerance: 3 frames at 30 fps is 0.0999… s
    this.trace.push({ t, metrics: { ...metrics } });
  }

  summary(): SessionSummary {
    const counted = this.reps.filter((r) => r.counted);
    const faults: Record<string, number> = {};
    for (const f of this.reps.flatMap((r) => r.faults)) faults[f] = (faults[f] ?? 0) + 1;
    return {
      exercise: this.exercise,
      started: this.started.toISOString(),
      reps: counted.length,
      cleanReps: counted.filter((r) => r.faults.length === 0).length,
      partialReps: this.reps.length - counted.length,
      faults,
      avgDownS: counted.length ? round2(mean(counted.map((r) => r.bottomS - r.startS))) : null,
      avgUpS: counted.length ? round2(mean(counted.map((r) => r.endS - r.bottomS))) : null,
    };
  }
}
