import { useEffect, useRef, useState } from "react";
import { NO_ANSWERS, feedbackBody, hasAnswer, sendFeedback, type FeedbackAnswers, type FeedbackSource } from "../cloud/feedback";
import type { ModelVariant } from "../pose/landmarker";
import type { SetRecord } from "../store/record";

/** How the sheet was closed: sent, "Not now" (or Escape), or "Don't ask again". */
export type FeedbackOutcome = "sent" | "later" | "never";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

const SCORES = [1, 2, 3, 4, 5];

/** A 1-5 question; tapping the selected score again clears it. */
function Scale({ question, low, high, value, onChange }: {
  question: string; low: string; high: string; value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <fieldset className="survey-q">
      <legend>{question}</legend>
      <div className="segmented scale">
        {SCORES.map((n) => (
          <button key={n} type="button" className={n === value ? "selected" : ""} aria-pressed={n === value}
            aria-label={n === 1 ? `1, ${low}` : n === 5 ? `5, ${high}` : String(n)}
            onClick={() => onChange(n === value ? null : n)}>{n}</button>
        ))}
      </div>
      <div className="scale-ends" aria-hidden><span>{low}</span><span>{high}</span></div>
    </fieldset>
  );
}

function Comment({ label, value, onChange, max = 1000 }: {
  label: string; value: string; onChange: (v: string) => void; max?: number;
}) {
  return (
    <label className="survey-comment">
      <span>{label}</span>
      <textarea rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** The feedback survey, as a modal sheet. Every question is optional; at least one answer sends it. */
export function FeedbackSheet({ source, set, model, onClose }: {
  source: FeedbackSource; set: SetRecord | null; model: ModelVariant; onClose: (outcome: FeedbackOutcome) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [a, setA] = useState<FeedbackAnswers>(NO_ANSWERS);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
  }, []);

  const field = <K extends keyof FeedbackAnswers>(key: K) => (value: FeedbackAnswers[K]) => setA((prev) => ({ ...prev, [key]: value }));
  const close = (outcome: FeedbackOutcome) => {
    ref.current?.close();
    onClose(outcome);
  };
  const submit = async () => {
    setStatus({ kind: "sending" });
    try {
      await sendFeedback(feedbackBody(source, a, model, set));
      setStatus({ kind: "sent" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (status.kind === "sent") {
    return (
      <dialog ref={ref} className="sheet survey" aria-labelledby="feedback-title" onCancel={(e) => { e.preventDefault(); close("sent"); }}>
        <h2 id="feedback-title">Thank you</h2>
        <p className="lede">Your answers help decide what gets fixed next.</p>
        <button className="primary big" autoFocus onClick={() => close("sent")}>Close</button>
      </dialog>
    );
  }

  return (
    <dialog ref={ref} className="sheet survey" aria-labelledby="feedback-title"
      onCancel={(e) => { e.preventDefault(); close("later"); }}>
      <h2 id="feedback-title">How's cleanReps working for you?</h2>
      <p className="lede">Five quick questions, all optional. {set ? "This set's rep and fault counts are" : "Your device type is"} sent along with your answers, never video.</p>

      <Scale question="How easy or difficult was it to complete your first workout using the app?"
        low="Very difficult" high="Very easy" value={a.ease} onChange={field("ease")} />
      {a.ease != null && <Comment label="What made it easy or difficult?" value={a.ease_comment} onChange={field("ease_comment")} />}

      <Scale question="How useful was the app's feedback for helping you improve your exercise form?"
        low="Not at all useful" high="Very useful" value={a.form_help} onChange={field("form_help")} />
      {a.form_help != null && <Comment label="Was any feedback incorrect, confusing, or especially helpful?"
        value={a.form_help_comment} onChange={field("form_help_comment")} />}

      <Scale question="How did the achievements affect your motivation to continue exercising?"
        low="Greatly reduced it" high="Greatly increased it" value={a.achievements}
        onChange={(v) => setA((prev) => ({ ...prev, achievements: v, achievements_unused: v == null && prev.achievements_unused }))} />
      <button type="button" className={`survey-optout${a.achievements_unused ? " selected" : ""}`} aria-pressed={a.achievements_unused}
        onClick={() => setA((prev) => ({ ...prev, achievements_unused: !prev.achievements_unused, achievements: null }))}>
        I didn't use or notice the achievements
      </button>

      <Scale question="How likely are you to use the app again?"
        low="Very unlikely" high="Very likely" value={a.use_again} onChange={field("use_again")} />
      {a.use_again != null && <Comment label="What is the main reason for your answer?"
        value={a.use_again_comment} onChange={field("use_again_comment")} />}

      <Comment label="If you could change only one thing about the app, what would it be?"
        value={a.one_change} onChange={field("one_change")} max={2000} />

      {status.kind === "error" && <p className="survey-error" role="alert">{status.message}</p>}
      <div className="sheet-actions">
        {source === "summary" && <button className="ghost" onClick={() => close("never")}>Don't ask again</button>}
        <button className="ghost" onClick={() => close("later")}>Not now</button>
        <button className="primary" disabled={!hasAnswer(a) || status.kind === "sending"} onClick={submit}>
          {status.kind === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </dialog>
  );
}
