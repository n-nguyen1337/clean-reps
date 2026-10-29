// In-app feedback: validates the form, rate-limits by the caller's IP, stores
// it in `feedback`, and optionally posts it to a chat webhook. Signing in is
// optional; when the caller is signed in, the entry records their user id.
//
// Secrets (all optional): FEEDBACK_WEBHOOK_URL (Discord or Slack incoming
// webhook), FEEDBACK_IP_SALT, FEEDBACK_DAILY_LIMIT (per IP, default 5),
// FEEDBACK_GLOBAL_DAILY_LIMIT (default 300), ALLOWED_ORIGINS.

import { z } from "npm:zod@4.6.7";
import { admin, caller, cors, json } from "../_shared/http.ts";

const SOURCE_DAILY = Number(Deno.env.get("FEEDBACK_DAILY_LIMIT") ?? 5);
const GLOBAL_DAILY = Number(Deno.env.get("FEEDBACK_GLOBAL_DAILY_LIMIT") ?? 300);
const WEBHOOK = Deno.env.get("FEEDBACK_WEBHOOK_URL");
// The service role key is secret and stable, so it works as a salt if no other is set.
const SALT = Deno.env.get("FEEDBACK_IP_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY_BYTES = 16_000;

const id = z.string().max(40);
const score = z.number().int().min(1).max(5).nullish();
const optText = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullish();

// Keys match the table's columns and bounds match its check constraints, so a
// valid request goes straight into submit_feedback and never fails the insert.
const FeedbackInput = z.object({
  source: z.enum(["summary", "settings"]),
  ease: score,
  ease_comment: optText(1000),
  form_help: score,
  form_help_comment: optText(1000),
  achievements: score,
  achievements_unused: z.boolean().default(false),
  use_again: score,
  use_again_comment: optText(1000),
  one_change: optText(2000),
  app_version: z.string().max(40),
  context: z.object({
    exercise: id.optional(),
    reps: z.number().int().min(0).max(500).optional(),
    clean_reps: z.number().int().min(0).max(500).optional(),
    faults: z.record(id, z.number().int().min(0).max(500)).refine((f) => Object.keys(f).length <= 12).optional(),
    model: z.enum(["lite", "full"]).optional(),
    device: z.enum(["phone", "tablet", "desktop"]).optional(),
    set_id: z.uuid().optional(),
  }).strict().default({}),
}).strict().refine((f) => !(f.achievements_unused && f.achievements != null), {
  message: "Pick a score or \"didn't use\" for achievements, not both.",
}).refine((f) => f.achievements_unused || [
  f.ease, f.ease_comment, f.form_help, f.form_help_comment, f.achievements,
  f.use_again, f.use_again_comment, f.one_change,
].some((v) => v != null), {
  message: "Answer at least one question.",
});
type Feedback = z.infer<typeof FeedbackInput>;

async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SALT}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const quote = (s: string) => `> ${s.replaceAll("\n", "\n> ")}`;

/** "Label: 4/5" with the comment quoted underneath; null when neither was given. */
function answer(label: string, score: number | null | undefined, comment?: string | null): string | null {
  if (score == null && !comment) return null;
  return [`${label}: ${score ?? "-"}/5`, comment && quote(comment)].filter(Boolean).join("\n");
}

/** Best effort: a failed or slow webhook doesn't fail the submission. */
async function notify(f: Feedback, signedIn: boolean): Promise<void> {
  if (!WEBHOOK) return;
  const c = f.context;
  const lines = [
    `**Feedback** (${f.source}${signedIn ? ", signed in" : ""}, v${f.app_version})`,
    c.exercise && `${c.exercise}: ${c.reps ?? "?"} reps, ${c.clean_reps ?? "?"} clean, ${c.model ?? "?"} model, ${c.device ?? "?"}`,
    answer("Ease of first workout", f.ease, f.ease_comment),
    answer("Form feedback usefulness", f.form_help, f.form_help_comment),
    f.achievements_unused ? "Achievements: didn't use or notice" : answer("Achievements motivation", f.achievements),
    answer("Likely to use again", f.use_again, f.use_again_comment),
    f.one_change && `One change:\n${quote(f.one_change)}`,
  ].filter(Boolean).join("\n");
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `content` is Discord's field and `text` is Slack's; each ignores the other.
      // allowed_mentions stops a message from pinging @everyone on Discord.
      body: JSON.stringify({ content: lines.slice(0, 2000), text: lines, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error("webhook", res.status, await res.text());
  } catch (err) {
    console.error("webhook", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Use POST." });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(req, 413, { error: "That feedback is too long." });
  let input: Feedback;
  try {
    input = FeedbackInput.parse(JSON.parse(text));
  } catch {
    return json(req, 400, { error: "The feedback wasn't in the expected format. Try updating the app." });
  }

  const user = await caller(req);
  const { data: result, error } = await admin.rpc("submit_feedback", {
    p_ip_hash: await ipHash(req),
    p_user: user?.id ?? null,
    p_entry: input,
    p_source_daily: SOURCE_DAILY,
    p_global_daily: GLOBAL_DAILY,
  });
  if (error) {
    console.error("submit_feedback", error);
    return json(req, 500, { error: "Couldn't send your feedback. Try again." });
  }
  if (!result.ok) {
    return json(req, 429, {
      error: result.reason === "source_limit"
        ? "Thanks, we've had plenty from you today. Try again tomorrow."
        : "We're getting a lot of feedback today. Try again tomorrow.",
    });
  }

  await notify(input, user != null);
  return json(req, 200, { ok: true });
});
