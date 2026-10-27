// Optional AI coaching: sends the set's numbers (never video) to Claude using
// the user's own API key, straight from the browser. There is no backend.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { SetAnalysis } from "../engine/analysis";
import type { SessionRecord } from "../engine/session";

const MODEL = "claude-haiku-5-5"; // a review costs about a tenth of a cent

export const CoachReport = z.object({
  headline: z.string().describe("One short sentence summing up the set"),
  assessment: z.string().describe("Two to four sentences on what the numbers show"),
  strengths: z.array(z.string()).describe("What went well, one short sentence each"),
  fixes: z.array(z.object({
    issue: z.string().describe("The problem, in a few words"),
    why: z.string().describe("Why it matters and what in the data shows it"),
    cue: z.string().describe("A short cue to think about during the next set"),
    drill: z.string().describe("One simple drill or regression to practise it"),
  })).describe("At most three, most important first"),
  next_set: z.string().describe("One concrete goal for the next set"),
});
export type CoachReport = z.infer<typeof CoachReport>;

const SYSTEM = `You are a strength coach reviewing one set recorded by cleanReps, a free browser app for home workouts. The app estimates 2D body landmarks from a single camera, counts reps, and checks a few form rules. You see the app's measurements, not the video.

Explain what the numbers mean for this person, focus on the one to three changes that would help most, and give a cue and a simple drill for each. Ground every claim in the data you were given, and say when the data can't tell (a metric that is null was not measurable from this camera angle). Angles from 2D landmarks depend on camera placement, so treat small differences as noise.

Write for someone training at home without a coach: plain language, short sentences, no jargon without a quick explanation. It renders on a phone, so keep each field brief. Do not diagnose injuries or give medical advice; if something might relate to pain or mobility limits, suggest checking with a qualified professional.`;

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

export async function getCoaching(apiKey: string, record: SessionRecord, analysis: SetAnalysis): Promise<CoachReport> {
  // The key is the user's own and never leaves this browser except to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(CoachReport) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Here is my set. Please coach me.\n\n${JSON.stringify(coachInput(record, analysis), null, 1)}`,
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Your API key was rejected. Check it in Settings.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error("Your API key doesn't have access to this model.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Rate limited by the API. Try again in a minute.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach the API. Check your connection.");
    if (err instanceof Anthropic.APIError) throw new Error(`API error: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined to review this set.");
  if (!response.parsed_output) throw new Error("The response couldn't be read. Try again.");
  return response.parsed_output;
}
