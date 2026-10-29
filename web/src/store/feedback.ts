// When to show the feedback survey after a set, kept in localStorage on this device.
// It's offered after a set with reps; "Not now" asks again after a while, and
// once it's sent or the user says never, it stops (Settings still has it).

const KEY = "cleanreps.feedback";
const REASK_DAYS = 14;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(value: string) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage unavailable: asked again next time */
  }
}

/** Stored value: "sent", "never", or the ISO time "Not now" was tapped. */
export function shouldAskFeedback(now = new Date()): boolean {
  const state = read();
  if (state === "sent" || state === "never") return false;
  const later = state ? Date.parse(state) : NaN;
  return Number.isNaN(later) || now.getTime() - later >= REASK_DAYS * 86_400_000;
}

export const feedbackSent = () => write("sent");
export const feedbackNever = () => write("never");
export const feedbackLater = (now = new Date()) => write(now.toISOString());
