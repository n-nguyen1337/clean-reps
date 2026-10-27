// AI coaching for a finished set. The browser sends only the set's numbers
// (never video) to the `coach` Edge Function, which calls Claude with the
// app's key and limits how many reviews each signed-in user gets per day.

import type { SupabaseClient } from "@supabase/supabase-js";
import { functionError } from "../cloud/account";
import type { SetAnalysis } from "../engine/analysis";
import type { SessionRecord } from "../engine/session";

/** Mirrors the schema in supabase/functions/coach/index.ts. */
export interface CoachReport {
  headline: string;
  assessment: string;
  strengths: string[];
  fixes: { issue: string; why: string; cue: string; drill: string }[];
  next_set: string;
}

const METRIC_NOTES: Record<string, string> = {
  knee_angle: "hip-knee-ankle angle in degrees; about 175 standing, about 90 with thighs parallel to the floor",
  hip_angle: "shoulder-hip-knee angle in degrees",
  torso_lean: "torso angle from vertical in degrees, measured from a side view only",
  knee_ratio: "knee spread divided by ankle spread, front view only; below about 0.8 means knees caving in",
  elbow_angle: "shoulder-elbow-wrist angle in degrees",
  elbow_drift: "upper-arm angle away from hanging straight down, in degrees",
  hip_offset: "hip distance from the shoulder-ankle line as a fraction of body length; positive is sagging, negative is piking",
};

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** The compact, numbers-only description of the set that goes to the model. */
export function coachInput(record: SessionRecord, analysis: SetAnalysis) {
  const { config, summary, body } = record;
  return {
    exercise: config.name,
    lifter_proportions: body,
    metrics: Object.fromEntries(
      [config.primaryMetric, ...config.rules.map((r) => r.metric)].map((m) => [m, METRIC_NOTES[m] ?? m]),
    ),
    rep_counting: {
      primary_metric: config.primaryMetric,
      counts_as_rep_below: config.bottomThreshold,
      standing_above: config.topThreshold,
    },
    rules: config.rules.map((r) => ({ id: r.id, metric: r.metric, min: r.min, max: r.max, cue: r.cue })),
    summary: {
      reps: summary.reps, clean_reps: summary.cleanReps, partial_reps: summary.partialReps,
      avg_down_s: summary.avgDownS, avg_up_s: summary.avgUpS, faults: summary.faults,
    },
    reps: analysis.rows.map((row) => ({
      rep: row.label,
      counted: row.rep.counted,
      down_s: r1(row.downS),
      up_s: r1(row.upS),
      worst_per_rule: Object.fromEntries(Object.entries(row.values).map(([id, v]) => [id, r1(v)])),
      faults: row.rep.faults,
    })),
    app_insights: analysis.insights.map((i) => i.text),
  };
}

export async function getCoaching(client: SupabaseClient, record: SessionRecord, analysis: SetAnalysis):
  Promise<{ report: CoachReport; remaining: number }> {
  const { data, error } = await client.functions.invoke("coach", { body: coachInput(record, analysis) });
  if (error) throw new Error(await functionError(error));
  return data;
}
