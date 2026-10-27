// Rep state machine plus a config-driven rule engine (port of cleanreps/exercises/base.py).
//
// One metric is the *primary* metric that drives rep counting. It must
// decrease going into the rep (e.g. knee angle in a squat) and increase
// coming out of it. Rules flag a fault when their metric leaves [min, max]:
// live rules (no aggregate) are checked every frame during a rep and must be
// violated for minFrames consecutive frames; rep rules (aggregate: min|max)
// are checked once, when the rep ends, against the metric's extreme. An
// optional `proportions` section shifts rule limits for the user's Body.

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
}

export interface ExerciseConfig {
  name: string;
  primaryMetric: string;
  topThreshold: number;
  bottomThreshold: number;
  hysteresis: number;
  minExcursion: number;
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
}

export const isClean = (r: RepResult) => r.counted && r.faults.length === 0;

const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);

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
      minFrames: r.min_frames ?? 3,
    };
  });
  const cfg: ExerciseConfig = {
    name: data.name,
    primaryMetric: data.primary_metric,
    topThreshold: data.top_threshold,
    bottomThreshold: data.bottom_threshold,
    hysteresis: data.hysteresis ?? 8,
    minExcursion: data.min_excursion ?? 25,
    partialCue: data.partial_cue ?? null,
    cameraHint: data.camera_hint ?? "",
    rules,
    proportions: data.proportions ?? {},
  };
  if (cfg.bottomThreshold >= cfg.topThreshold) {
    throw new Error("bottom_threshold must be below top_threshold");
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
  }

  reset(): void {
    this.phase = "top";
    this.reps = 0;
    this.rep = null;
    this.lastSeen = null;
  }

  update(input: P | null, t: number): ExerciseUpdate {
    const metrics = input !== null ? this.computeMetrics(input) : {};
    const value = metrics[this.config.primaryMetric];

    if (missing(value)) return this.lost(metrics, t);
    this.lastSeen = t;

    const cues: Cue[] = [];
    if (this.rep !== null) cues.push(...this.rep.observe(metrics, t, this.liveRules));

    const cfg = this.config;
    let completed: RepResult | null = null;
    switch (this.phase) {
      case "top":
        if (value < cfg.topThreshold - cfg.hysteresis) {
          this.phase = "descending";
          this.rep = new RepTracker(t, cfg.primaryMetric);
          cues.push(...this.rep.observe(metrics, t, this.liveRules));
        }
        break;
      case "descending":
        if (value <= cfg.bottomThreshold) {
          this.phase = "bottom";
        } else if (value >= cfg.topThreshold) {
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
        } else if (value >= cfg.topThreshold) {
          completed = this.complete(t, cues);
        }
        break;
    }
    return { phase: this.phase, reps: this.reps, metrics, tracking: true, cues, completed };
  }

  private lost(metrics: Metrics, t: number): ExerciseUpdate {
    const cues: Cue[] = [];
    const lostFor = this.lastSeen !== null ? t - this.lastSeen : Infinity;
    if (lostFor >= LOST_CUE_AFTER_S) {
      cues.push({ id: "tracking", text: "Step back so your whole body is visible", priority: 1 });
    }
    if (lostFor >= LOST_ABORT_AFTER_S && this.rep !== null) {
      this.phase = "top";
      this.rep = null;
    }
    return { phase: this.phase, reps: this.reps, metrics, tracking: false, cues, completed: null };
  }

  private complete(t: number, cues: Cue[]): RepResult {
    const rep = this.rep!;
    this.rep = null;
    this.phase = "top";
    this.reps += 1;

    for (const rule of this.repRules) {
      const extreme = rep.extremes[rule.metric];
      if (extreme === undefined) continue;
      const value = rule.aggregate === "min" ? extreme[0] : extreme[1];
      if (violated(rule, value) && !rep.faults.includes(rule.id)) {
        rep.faults.push(rule.id);
        cues.push({ id: rule.id, text: rule.cue, priority: rule.priority });
      }
    }

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
    if (this.config.topThreshold - lowest < this.config.minExcursion) return null;
    return {
      counted: false, index: null, startS: rep.startS, bottomS: rep.bottomS, endS: t,
      faults: ["partial"], extremes: rep.extremes,
    };
  }
}
