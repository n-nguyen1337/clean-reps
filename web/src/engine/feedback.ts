// Turns a stream of cues into one readable message at a time (port of cleanreps/feedback.py).

import type { Cue } from "./exercise";

/** Shows one cue at a time, highest priority first.
 *
 *  A cue stays on screen for `displayS`. A higher-priority cue can replace it
 *  early; a lower-priority one waits. The same cue id is not repeated within
 *  `cooldownS`, so a persistent fault doesn't spam the user. */
export class CueManager {
  private active: Cue | null = null;
  private activeSince = 0;
  private lastShown = new Map<string, number>();

  constructor(
    readonly displayS = 2.0,
    readonly cooldownS = 4.0,
    private speak?: (text: string) => void,
  ) {}

  push(cues: Cue[], t: number): void {
    // Stable sort, like Python's sorted(..., reverse=True) on priority.
    for (const cue of [...cues].sort((a, b) => b.priority - a.priority)) {
      if (t - (this.lastShown.get(cue.id) ?? -1e9) < this.cooldownS) continue;
      const active = this.current(t);
      if (active !== null && active.priority > cue.priority) continue;
      this.active = cue;
      this.activeSince = t;
      this.lastShown.set(cue.id, t);
      this.speak?.(cue.text);
      return;
    }
  }

  current(t: number): Cue | null {
    if (this.active !== null && t - this.activeSince > this.displayS) this.active = null;
    return this.active;
  }
}

/** Browser text-to-speech. Drops lines while speaking so audio never falls
 *  behind the workout. Call `unlock` from a tap: iOS Safari only allows
 *  speech after a user gesture. */
export class Speaker {
  enabled = true;

  unlock(): void {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }

  say = (text: string): void => {
    if (!this.enabled || !("speechSynthesis" in window) || speechSynthesis.speaking) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1;
    speechSynthesis.speak(u);
  };
}
