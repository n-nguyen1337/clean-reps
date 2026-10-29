import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_ANSWERS, feedbackBody, hasAnswer } from "../../cloud/feedback";
import type { SetRecord } from "../record";
import { feedbackLater, feedbackNever, feedbackSent, shouldAskFeedback } from "../feedback";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

describe("shouldAskFeedback", () => {
  const day = 86_400_000;
  const now = new Date("2026-11-01T12:00:00Z");

  it("asks until answered", () => {
    expect(shouldAskFeedback(now)).toBe(true);
  });

  it("stops once sent or declined for good", () => {
    feedbackSent();
    expect(shouldAskFeedback(now)).toBe(false);
    feedbackNever();
    expect(shouldAskFeedback(now)).toBe(false);
  });

  it("asks again 14 days after Not now", () => {
    feedbackLater(now);
    expect(shouldAskFeedback(new Date(now.getTime() + 13 * day))).toBe(false);
    expect(shouldAskFeedback(new Date(now.getTime() + 14 * day))).toBe(true);
  });

  it("asks when storage is unavailable or holds junk", () => {
    localStorage.setItem("cleanreps.feedback", "garbage");
    expect(shouldAskFeedback(now)).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => feedbackSent()).not.toThrow();
    expect(shouldAskFeedback(now)).toBe(true);
  });
});

describe("hasAnswer", () => {
  it("needs a score, a comment or the achievements opt-out", () => {
    expect(hasAnswer(NO_ANSWERS)).toBe(false);
    expect(hasAnswer({ ...NO_ANSWERS, one_change: "   " })).toBe(false);
    expect(hasAnswer({ ...NO_ANSWERS, use_again: 1 })).toBe(true);
    expect(hasAnswer({ ...NO_ANSWERS, form_help_comment: "cue was late" })).toBe(true);
    expect(hasAnswer({ ...NO_ANSWERS, achievements_unused: true })).toBe(true);
  });
});

describe("feedbackBody", () => {
  const set = {
    id: "0b9f6c1e-3f7a-4a51-9a52-3c2a4c1e8d10",
    summary: { exercise: "squat", started: "2026-11-01T12:00:00.000Z", reps: 8, cleanReps: 6, partialReps: 1,
      faults: { depth: 2 }, avgDownS: 1, avgUpS: 1 },
    reps: [{ index: 1 }],
  } as unknown as SetRecord;

  it("sends the set's numbers, not its rep data", () => {
    const body = feedbackBody("summary", { ...NO_ANSWERS, ease: 4 }, "lite", set);
    expect(body).toMatchObject({ source: "summary", ease: 4, context: {
      model: "lite", device: "desktop", exercise: "squat", reps: 8, clean_reps: 6, faults: { depth: 2 }, set_id: set.id,
    } });
    expect(JSON.stringify(body)).not.toContain("index");
  });

  it("sends only the device from Settings", () => {
    expect(feedbackBody("settings", NO_ANSWERS, "full", null).context).toEqual({ model: "full", device: "desktop" });
  });
});
