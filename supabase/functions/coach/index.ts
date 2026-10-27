// AI coaching for one set: validates the set's numbers, checks the caller's
// daily allowance, and asks Claude for a structured review. The Anthropic key
// lives only in this function's secrets.
//
// Secrets: ANTHROPIC_API_KEY (required), COACH_DAILY_LIMIT (per user, default 10),
// COACH_GLOBAL_DAILY_LIMIT (all users, default 500; caps spend), ALLOWED_ORIGINS.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/zod";
import { z } from "npm:zod@4.6.7";
import { admin, caller, cors, json } from "../_shared/http.ts";

const MODEL = "claude-haiku-5-5"; // a review costs about a tenth of a cent
const USER_DAILY = Number(Deno.env.get("COACH_DAILY_LIMIT") ?? 10);
const GLOBAL_DAILY = Number(Deno.env.get("COACH_GLOBAL_DAILY_LIMIT") ?? 500);
const MAX_BODY_BYTES = 64_000;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const CoachReport = z.object({
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

// The shape coachInput() in web/src/ai/coach.ts sends, with tight bounds so the
// endpoint can't be used as a general-purpose proxy to Claude.
const id = z.string().max(40);
const num = z.number().finite().nullable();
const size = z.enum(["short", "average", "long"]);
const CoachInput = z.object({
  exercise: id,
  lifter_proportions: z.object({ femur: size, torso: size }).strict(),
  metrics: z.record(id, z.string().max(200)).refine((m) => Object.keys(m).length <= 10),
  rep_counting: z.object({ primary_metric: id, counts_as_rep_below: z.number(), standing_above: z.number() }).strict(),
  rules: z.array(z.object({ id, metric: id, min: num, max: num, cue: z.string().max(80) }).strict()).max(10),
  summary: z.object({
    reps: z.number().int().min(0).max(500),
    clean_reps: z.number().int().min(0).max(500),
    partial_reps: z.number().int().min(0).max(500),
    avg_down_s: num,
    avg_up_s: num,
    faults: z.record(id, z.number().int()).refine((f) => Object.keys(f).length <= 12),
  }).strict(),
  reps: z.array(z.object({
    rep: z.string().max(6),
    counted: z.boolean(),
    down_s: num,
    up_s: num,
    worst_per_rule: z.record(id, num).refine((w) => Object.keys(w).length <= 10),
    faults: z.array(id).max(10),
  }).strict()).min(1).max(200),
  app_insights: z.array(z.string().max(200)).max(15),
}).strict();

const SYSTEM = `You are a strength coach reviewing one set recorded by cleanReps, a free browser app for home workouts. The app estimates 2D body landmarks from a single camera, counts reps, and checks a few form rules. You see the app's measurements, not the video.

Explain what the numbers mean for this person, focus on the one to three changes that would help most, and give a cue and a simple drill for each. Ground every claim in the data you were given, and say when the data can't tell (a metric that is null was not measurable from this camera angle). Angles from 2D landmarks depend on camera placement, so treat small differences as noise.

Write for someone training at home without a coach: plain language, short sentences, no jargon without a quick explanation. It renders on a phone, so keep each field brief. Do not diagnose injuries or give medical advice; if something might relate to pain or mobility limits, suggest checking with a qualified professional.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Use POST." });

  const user = await caller(req);
  if (!user) return json(req, 401, { error: "Sign in to get AI coaching." });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(req, 413, { error: "This set is too large to review." });
  let input: z.infer<typeof CoachInput>;
  try {
    input = CoachInput.parse(JSON.parse(text));
  } catch {
    return json(req, 400, { error: "The set data wasn't in the expected format. Try updating the app." });
  }

  const { data: claim, error: claimError } = await admin.rpc("claim_coach_request", {
    p_user: user.id, p_user_daily: USER_DAILY, p_global_daily: GLOBAL_DAILY,
  });
  if (claimError) return json(req, 500, { error: "Couldn't check your coaching allowance. Try again." });
  if (!claim.ok) {
    return json(req, 429, {
      error: claim.reason === "user_limit"
        ? `You've used today's ${USER_DAILY} AI reviews. More tomorrow.`
        : "AI coaching is busy today. Try again tomorrow.",
    });
  }
  // A failed review shouldn't use up the user's allowance.
  const refund = () => admin.from("coach_requests").delete().eq("id", claim.request_id);

  let response;
  try {
    response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(CoachReport) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Here is my set. Please coach me.\n\n${JSON.stringify(input, null, 1)}`,
      }],
    });
  } catch (err) {
    await refund();
    console.error("anthropic", err);
    if (err instanceof Anthropic.RateLimitError) return json(req, 503, { error: "AI coaching is busy. Try again in a minute." });
    if (err instanceof Anthropic.APIConnectionError) return json(req, 503, { error: "Couldn't reach the AI service. Try again." });
    return json(req, 502, { error: "The AI review failed. Try again." });
  }

  if (response.stop_reason === "refusal") {
    await refund();
    return json(req, 422, { error: "The model declined to review this set." });
  }
  if (!response.parsed_output) {
    await refund();
    return json(req, 502, { error: "The response couldn't be read. Try again." });
  }
  return json(req, 200, { report: response.parsed_output, remaining: claim.remaining });
});
