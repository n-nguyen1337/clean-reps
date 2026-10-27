// A finished set as it is stored on the device and synced to the account.
// Keeps the rep results and the exercise config the set ran with, so a past
// set reopens in the Summary screen exactly as it was, even after thresholds
// are retuned. The 10 Hz trace is left out to keep each set to a few KB.

import type { Body, ExerciseConfig, RepResult } from "../engine/exercise";
import type { SessionRecord, SessionSummary } from "../engine/session";

export const SET_SCHEMA_VERSION = 1;

export interface SetRecord {
  id: string;
  v: number;
  summary: SessionSummary;
  durationS: number | null;
  reps: RepResult[];
  config: ExerciseConfig;
  body: Body;
  appVersion: string;
  /** Changes on every local edit (only deletes, today). */
  updatedAt: string;
  deletedAt: string | null;
  /** The `updatedAt` last pushed to or pulled from the account; null if never synced. */
  syncedAt: string | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function toSetRecord(record: SessionRecord, now = new Date(), id = crypto.randomUUID()): SetRecord {
  const { trace } = record;
  return {
    id,
    v: SET_SCHEMA_VERSION,
    summary: record.summary,
    durationS: trace.length > 1 ? r2(trace[trace.length - 1].t - trace[0].t) : null,
    reps: record.reps.map((rep) => ({
      ...rep,
      startS: r2(rep.startS),
      bottomS: r2(rep.bottomS),
      endS: r2(rep.endS),
      extremes: Object.fromEntries(Object.entries(rep.extremes).map(([m, [lo, hi]]) => [m, [r2(lo), r2(hi)]])),
    })),
    config: record.config,
    body: record.body,
    appVersion: __APP_VERSION__,
    updatedAt: now.toISOString(),
    deletedAt: null,
    syncedAt: null,
  };
}

/** A stored set in the shape the Summary screen takes. Past sets have no trace. */
export function toSessionRecord(set: SetRecord): SessionRecord {
  return { summary: set.summary, reps: set.reps, trace: [], config: set.config, body: set.body };
}
