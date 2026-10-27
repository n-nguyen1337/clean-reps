// Collects rep results into a session summary (port of cleanreps/session.py).

import type { RepResult } from "./exercise";

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

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export class Session {
  readonly started = new Date();
  readonly reps: RepResult[] = [];

  constructor(readonly exercise: string) {}

  add(rep: RepResult): void {
    this.reps.push(rep);
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
