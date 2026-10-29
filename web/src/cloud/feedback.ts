// The in-app survey, sent to the `feedback` Edge Function (supabase/functions/feedback),
// which stores it in the `feedback` table. Signing in isn't needed: signed out,
// supabase-js sends the anon key, and the function records a user id only when there is one.

import type { ModelVariant } from "../pose/landmarker";
import type { SetRecord } from "../store/record";
import { functionError, getClient } from "./account";

export type FeedbackSource = "summary" | "settings";

/** Scores are 1-5; null means unanswered. Keys match the table's columns. */
export interface FeedbackAnswers {
  ease: number | null;
  ease_comment: string;
  form_help: number | null;
  form_help_comment: string;
  achievements: number | null;
  achievements_unused: boolean;
  use_again: number | null;
  use_again_comment: string;
  one_change: string;
}

export const NO_ANSWERS: FeedbackAnswers = {
  ease: null, ease_comment: "", form_help: null, form_help_comment: "",
  achievements: null, achievements_unused: false, use_again: null, use_again_comment: "", one_change: "",
};

/** The function rejects a survey with nothing filled in. */
export function hasAnswer(a: FeedbackAnswers): boolean {
  return a.achievements_unused || [a.ease, a.form_help, a.achievements, a.use_again].some((s) => s != null)
    || [a.ease_comment, a.form_help_comment, a.use_again_comment, a.one_change].some((s) => s.trim() !== "");
}

export function deviceKind(): "phone" | "tablet" | "desktop" {
  if (!matchMedia("(pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
}

/** The request body: the answers plus what the set looked like, never video or landmarks. */
export function feedbackBody(source: FeedbackSource, answers: FeedbackAnswers, model: ModelVariant, set: SetRecord | null) {
  const s = set?.summary;
  return {
    source,
    ...answers,
    app_version: __APP_VERSION__,
    context: {
      model,
      device: deviceKind(),
      ...(set && s && {
        exercise: s.exercise,
        reps: s.reps,
        clean_reps: s.cleanReps,
        faults: Object.fromEntries(Object.entries(s.faults).slice(0, 12)),
        set_id: set.id,
      }),
    },
  };
}

export async function sendFeedback(body: ReturnType<typeof feedbackBody>): Promise<void> {
  const client = await getClient();
  const { error } = await client.functions.invoke("feedback", { body });
  if (error) throw new Error(await functionError(error));
}
