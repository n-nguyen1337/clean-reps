// Rep state machine plus a config-driven rule engine (port of cleanreps/exercises/base.py).
//
// One metric is the *primary* metric that drives rep counting. It must
// decrease going into the rep (e.g. knee angle in a squat) and increase
// coming out of it. Rules flag a fault when their metric leaves [min, max]:
// live rules (no aggregate) are checked every frame during a rep and must be
// violated for minFrames consecutive frames; rep rules (aggregate: min|max)
// are checked once, when the rep ends, against the metric's extreme. A rule
// with no_rep also stops the rep from counting when it fires. An optional
// `proportions` section shifts rule limits for the user's Body.

export const LOST_CUE_AFTER_S = 1.0;
export const LOST_ABORT_AFTER_S = 2.0;

export const BODY_SIZES = ["short", "average", "long"] as const;
export type BodySize = (typeof BODY_SIZES)[number];
const BODY_SEGMENTS = ["femur", "torso"] as const;

/** The user's limb proportions, relative to average. */
export interface Body {
  femur: BodySize;
  torso: BodySize;
}

export const AVERAGE_BODY: Body = { femur: "average", torso: "average" };

export type Phase = "top" | "descending" | "bottom" | "ascending";
export type Metrics = Record<string, number | null>;

export interface Rule {
  id: string;
  metric: string;
  cue: string;
  priority: number;
  min: number | null;
  max: number | null;
  aggregate: "min" | "max" | null;
  minFrames: number;
  /** A rep with this fault doesn't count. */
  noRep: boolean;
}

export interface ExerciseConfig {
  name: string;
  primaryMetric: string;
  topThreshold: number;
  bottomThreshold: number;
  hysteresis: number;
  minExcursion: number;
  /** Time at the top, tracked, before the first rep can start. */
  readyS: number;
  /** Learn the top as (standing - margin) while settling; null keeps topThreshold. */
  topMargin: number | null;
  /** The lowest a learned top can go. */
  topFloor: number | null;
  partialCue: string | null;
  cameraHint: string;
  rules: Rule[];
  /** segment -> size -> rule id -> amount added to that rule's min and max */
  proportions: Partial<Record<keyof Body, Partial<Record<BodySize, Record<string, number>>>>>;
}

export interface Cue {
  id: string;
  text: string;
  priority: number;
}

export interface RepResult {
  counted: boolean;
  index: number | null; // rep number if counted
  startS: number;
  bottomS: number;
  endS: number;
  faults: string[];
  extremes: Record<string, [number, number]>; // metric -> [min, max]
}

export interface ExerciseUpdate {
  phase: Phase;
  reps: number;
  metrics: Metrics;
  tracking: boolean;
  cues: Cue[];
  completed: RepResult | null;
  /** False until the user has settled at the top. */
  ready: boolean;
}

export const isClean = (r: RepResult) => r.counted && r.faults.length === 0;

const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);

/** The lower quartile of how the user stands sets their top (see topMargin). */
const STANDING_QUANTILE = 0.25;

/** Linear interpolation between closest ranks, as numpy's default (and base.py's quantile). */
export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function violated(rule: Rule, value: number | null | undefined): boolean {
  if (missing(value)) return false;
  return (rule.min !== null && value < rule.min) || (rule.max !== null && value > rule.max);
}

/** Parse a rules file as loaded from YAML (snake_case keys, same defaults as Python). */
export function parseConfig(data: Record<string, any>): ExerciseConfig {
  const rules: Rule[] = (data.rules ?? []).map((r: Record<string, any>) => {
    if (![undefined, null, "min", "max"].includes(r.aggregate)) {
      throw new Error(`rule ${JSON.stringify(r.id)}: aggregate must be min or max`);
    }
    return {
      id: r.id, metric: r.metric, cue: r.cue, priority: r.priority ?? 1,
      min: r.min ?? null, max: r.max ?? null, aggregate: r.aggregate ?? null,
      minFrames: r.min_frames ?? 3, noRep: r.no_rep ?? false,
    };
  });
  const cfg: ExerciseConfig = {
    name: data.name,
    primaryMetric: data.primary_metric,
    topThreshold: data.top_threshold,
    bottomThreshold: data.bottom_threshold,
    hysteresis: data.hysteresis ?? 8,
    minExcursion: data.min_excursion ?? 25,
    readyS: data.ready_s ?? 0.75,
    topMargin: data.top_margin ?? null,
    topFloor: data.top_floor ?? null,
    partialCue: data.partial_cue ?? null,
    cameraHint: data.camera_hint ?? "",
    rules,
    proportions: data.proportions ?? {},
  };
  if (cfg.bottomThreshold >= cfg.topThreshold) {
    throw new Error("bottom_threshold must be below top_threshold");
  }
  if (cfg.topMargin !== null && (cfg.topFloor === null || !(cfg.bottomThreshold < cfg.topFloor - cfg.hysteresis)
    || cfg.topFloor > cfg.topThreshold)) {
    throw new Error("top_margin needs a top_floor between bottom_threshold + hysteresis and top_threshold");
  }
  const ruleIds = new Set(rules.map((r) => r.id));
  for (const [segment, sizes] of Object.entries(cfg.proportions)) {
    if (!(BODY_SEGMENTS as readonly string[]).includes(segment)) {
      throw new Error(`proportions: unknown segment ${JSON.stringify(segment)}`);
    }
    for (const [size, shifts] of Object.entries(sizes ?? {})) {
      if (!(BODY_SIZES as readonly string[]).includes(size)) {
        throw new Error(`proportions.${segment}: unknown size ${JSON.stringify(size)}`);
      }
      const unknown = Object.keys(shifts).filter((id) => !ruleIds.has(id)).sort();
      if (unknown.length) throw new Error(`proportions.${segment}.${size}: unknown rules ${unknown.join(", ")}`);
    }
  }
  return cfg;
}

/** The config with rule limits shifted for the given proportions. */
export function forBody(cfg: ExerciseConfig, body: Body): ExerciseConfig {
  const shift: Record<string, number> = {};
  for (const segment of BODY_SEGMENTS) {
    for (const [id, amount] of Object.entries(cfg.proportions[segment]?.[body[segment]] ?? {})) {
      shift[id] = (shift[id] ?? 0) + amount;
    }
  }
  const rules = cfg.rules.map((r) => r.id in shift
    ? { ...r, min: r.min === null ? null : r.min + shift[r.id], max: r.max === null ? null : r.max + shift[r.id] }
    : r);
  return { ...cfg, rules };
}

/** Accumulates metric extremes and live-rule faults over one rep. */
class RepTracker {
  bottomS: number;
  extremes: Record<string, [number, number]> = {};
  faults: string[] = [];
  private streaks: Record<string, number> = {};

  constructor(readonly startS: number, private primary: string) {
    this.bottomS = startS;
  }

  observe(metrics: Metrics, t: number, liveRules: Rule[]): Cue[] {
    for (const [name, value] of Object.entries(metrics)) {
      if (missing(value)) continue;
      const [lo, hi] = this.extremes[name] ?? [value, value];
      if (name === this.primary && value < lo) this.bottomS = t;
      this.extremes[name] = [Math.min(lo, value), Math.max(hi, value)];
    }

    const cues: Cue[] = [];
    for (const rule of liveRules) {
      if (violated(rule, metrics[rule.metric])) {
        this.streaks[rule.id] = (this.streaks[rule.id] ?? 0) + 1;
        if (this.streaks[rule.id] === rule.minFrames && !this.faults.includes(rule.id)) {
          this.faults.push(rule.id);
          cues.push({ id: rule.id, text: rule.cue, priority: rule.priority });
        }
      } else {
        this.streaks[rule.id] = 0;
      }
    }
    return cues;
  }
}

/** Counts reps and checks rules for one exercise. `computeMetrics` maps an
 *  input (normally a PoseFrame) to named metrics, null when unmeasurable. */
export class Exercise<P> {
  phase: Phase = "top";
  reps = 0;
  private rep: RepTracker | null = null;
  private lastSeen: number | null = null;
  /** Nothing counts until the user has held the top for readyS: getting up from the camera isn't a rep. */
  ready = false;
  private settling: number[] = []; // primary metric while settling
  private settlingSince: number | null = null;
  /** This set's top threshold, learned from how the user stands once settled (see topMargin). */
  top: number;
  /** The user's standing value of the primary metric, once learned. */
  standing: number | null = null;
  private liveRules: Rule[];
  private repRules: Rule[];

  constructor(
    readonly key: string,
    readonly config: ExerciseConfig,
    readonly metricNames: readonly string[],
    private computeMetrics: (input: P) => Metrics,
  ) {
    const known = new Set(metricNames);
    const unknown = [config.primaryMetric, ...config.rules.map((r) => r.metric)].filter((m) => !known.has(m));
    if (unknown.length) {
      throw new Error(`${key}: unknown metrics in config: ${[...new Set(unknown)].sort().join(", ")}`);
    }
    this.liveRules = config.rules.filter((r) => r.aggregate === null);
    this.repRules = config.rules.filter((r) => r.aggregate !== null);
    this.top = config.topThreshold;
  }

  reset(): void {
    this.phase = "top";
    this.reps = 0;
    this.rep = null;
    this.lastSeen = null;
    this.unsettle();
  }

  private unsettle(): void {
    this.ready = false;
    this.settling = [];
    this.settlingSince = null;
    this.top = this.config.topThreshold;
    this.standing = null;
  }

  private settle(): void {
    this.ready = true;
    const cfg = this.config;
    if (cfg.topMargin !== null) {
      this.standing = quantile(this.settling, STANDING_QUANTILE);
      this.top = Math.min(cfg.topThreshold, Math.max(cfg.topFloor!, this.standing - cfg.topMargin));
    }
  }

  update(input: P | null, t: number): ExerciseUpdate {
    const metrics = input !== null ? this.computeMetrics(input) : {};
    const value = metrics[this.config.primaryMetric];

    if (missing(value)) return this.lost(metrics, t);
    this.lastSeen = t;

    const cfg = this.config;
    if (!this.ready) {
      if (value < cfg.topThreshold - cfg.hysteresis) {
        this.settlingSince = null;
        this.settling = [];
      } else {
        if (this.settlingSince === null) this.settlingSince = t;
        this.settling.push(value);
      }
      if (this.settlingSince === null || t - this.settlingSince < cfg.readyS) {
        return { phase: this.phase, reps: this.reps, metrics, tracking: true, cues: [], completed: null, ready: false };
      }
      this.settle();
    }

    const cues: Cue[] = [];
    if (this.rep !== null) cues.push(...this.rep.observe(metrics, t, this.liveRules));

    let completed: RepResult | null = null;
    switch (this.phase) {
      case "top":
        if (value < this.top - cfg.hysteresis) {
          this.phase = "descending";
          this.rep = new RepTracker(t, cfg.primaryMetric);
          cues.push(...this.rep.observe(metrics, t, this.liveRules));
        }
        break;
      case "descending":
        if (value <= cfg.bottomThreshold) {
          this.phase = "bottom";
        } else if (value >= this.top) {
          completed = this.abort(t);
          if (completed !== null && cfg.partialCue) {
            cues.push({ id: "partial", text: cfg.partialCue, priority: 3 });
          }
        }
        break;
      case "bottom":
        if (value > cfg.bottomThreshold + cfg.hysteresis) this.phase = "ascending";
        break;
      case "ascending":
        if (value <= cfg.bottomThreshold) {
          this.phase = "bottom";
        } else if (value >= this.top) {
          completed = this.complete(t, cues);
        }
        break;
    }
    return { phase: this.phase, reps: this.reps, metrics, tracking: true, cues, completed, ready: true };
  }

  private lost(metrics: Metrics, t: number): ExerciseUpdate {
    const cues: Cue[] = [];
    const lostFor = this.lastSeen !== null ? t - this.lastSeen : Infinity;
    if (lostFor >= LOST_CUE_AFTER_S) {
      cues.push({ id: "tracking", text: "Step back so your whole body is visible", priority: 1 });
    }
    this.settlingSince = null; // settling needs unbroken tracking
    this.settling = [];
    if (lostFor >= LOST_ABORT_AFTER_S && this.ready) {
      this.phase = "top";
      this.rep = null;
      this.unsettle(); // whoever comes back may stand differently
    }
    return { phase: this.phase, reps: this.reps, metrics, tracking: false, cues, completed: null, ready: this.ready };
  }

  /** Rep rules the rep breaks, judged on each metric's extreme over the rep. */
  private broken(rep: RepTracker): Rule[] {
    return this.repRules.filter((rule) => {
      const extreme = rep.extremes[rule.metric];
      if (extreme === undefined) return false;
      const value = rule.aggregate === "min" ? extreme[0] : extreme[1];
      return violated(rule, value) && !rep.faults.includes(rule.id);
    });
  }

  /** The noRep rules that fired: the movement wasn't the exercise. */
  private blocking(rep: RepTracker, broken: Rule[]): Rule[] {
    return this.config.rules.filter((r) => r.noRep && (broken.includes(r) || rep.faults.includes(r.id)));
  }

  private complete(t: number, cues: Cue[]): RepResult {
    const rep = this.rep!;
    this.rep = null;
    this.phase = "top";

    const broken = this.broken(rep);
    const blocking = this.blocking(rep, broken);
    if (blocking.length) {
      // Not the exercise at all: say only why, not how to do it better.
      for (const r of blocking) if (broken.includes(r)) cues.push({ id: r.id, text: r.cue, priority: r.priority });
      return {
        counted: false, index: null, startS: rep.startS, bottomS: rep.bottomS, endS: t,
        faults: blocking.map((r) => r.id), extremes: rep.extremes,
      };
    }
    for (const r of broken) {
      rep.faults.push(r.id);
      cues.push({ id: r.id, text: r.cue, priority: r.priority });
    }

    this.reps += 1;
    const result: RepResult = {
      counted: true, index: this.reps, startS: rep.startS, bottomS: rep.bottomS, endS: t,
      faults: rep.faults, extremes: rep.extremes,
    };
    if (isClean(result)) cues.push({ id: "good_rep", text: "Good rep", priority: 0 });
    return result;
  }

  /** Back at the top without reaching the bottom: report a partial rep
   *  if the movement was big enough to be a real attempt. */
  private abort(t: number): RepResult | null {
    const rep = this.rep!;
    this.rep = null;
    this.phase = "top";
    const lowest = rep.extremes[this.config.primaryMetric]?.[0] ?? Infinity;
    // Depth from standing (at most topThreshold), not from a lower learned top.
    const standing = this.standing === null ? this.top : Math.min(this.standing, this.config.topThreshold);
    if (standing - lowest < this.config.minExcursion) return null;
    // Not an attempt at the exercise, such as walking up to the camera.
    if (this.blocking(rep, this.broken(rep)).length) return null;
    return {
      counted: false, index: null, startS: rep.startS, bottomS: rep.bottomS, endS: t,
      faults: ["partial"], extremes: rep.extremes,
    };
  }
}
