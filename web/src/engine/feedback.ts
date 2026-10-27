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
    private speak?: (cue: Cue) => void,
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
      this.speak?.(cue);
      return;
    }
  }

  current(t: number): Cue | null {
    if (this.active !== null && t - this.activeSince > this.displayS) this.active = null;
    return this.active;
  }
}

/** Browser audio cues: a chime for a clean rep, text-to-speech for the rest.
 *  Drops lines while speaking so audio never falls behind the workout. Call
 *  `unlock` from a tap: iOS Safari only allows audio after a user gesture. */
export class Speaker {
  enabled = true;
  private ctx: AudioContext | null = null;

  unlock(): void {
    if ("AudioContext" in window) {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    }
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }

  say = (cue: Cue): void => {
    if (!this.enabled) return;
    if (cue.id === "good_rep") return this.ding();
    if (!("speechSynthesis" in window) || speechSynthesis.speaking) return;
    const u = new SpeechSynthesisUtterance(cue.text);
    u.rate = 1.1;
    speechSynthesis.speak(u);
  };

  /** Two quick rising sine notes (B5 -> E6), like a coin pickup. */
  private ding(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, start] of [[987.77, 0], [1318.51, 0.08]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(0.25, t0 + start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.45);
    }
  }
}
