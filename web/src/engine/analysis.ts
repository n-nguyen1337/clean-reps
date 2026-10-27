// Per-rep stats and plain-language insights for the summary screen. Pure
// functions of the rep results, so they're testable without a camera.

import type { ExerciseConfig, RepResult, Rule } from "./exercise";

export interface MetricInfo {
  label: string;
  unit: string;
  /** How to get this metric measured when it's missing. */
  hint?: string;
}

export const METRIC_INFO: Record<string, MetricInfo> = {
  knee_angle: { label: "Knee angle", unit: "°" },
  hip_angle: { label: "Hip angle", unit: "°" },
  torso_lean: { label: "Torso lean", unit: "°", hint: "Film from the side to check it." },
  knee_ratio: { label: "Knee width ÷ ankle width", unit: "", hint: "Film from the front to check it." },
  elbow_angle: { label: "Elbow angle", unit: "°" },
  hip_offset: { label: "Hip offset", unit: "", hint: "Film from the side to check it." },
};

export const metricInfo = (metric: string): MetricInfo => METRIC_INFO[metric] ?? { label: metric, unit: "" };

export interface RepRow {
  label: string; // "1", "2", … for counted reps, "P1", "P2", … for partials
  rep: RepResult;
  downS: number;
  upS: number;
  /** Lowest primary-metric value: the bottom of the rep. */
  bottom: number | null;
  /** Each rule's worst value over the rep (the side that rule checks). */
  values: Record<string, number | null>;
}

export interface RulePoint {
  label: string;
  value: number | null;
  faulted: boolean;
}

export interface RuleSeries {
  rule: Rule;
  info: MetricInfo;
  limit: number;
  /** Which side of the limit is a fault. */
  faultSide: "above" | "below";
  points: RulePoint[];
}

export interface Insight {
  tone: "warn" | "good" | "info";
  text: string;
}

export interface SetAnalysis {
  rows: RepRow[];
  rules: RuleSeries[];
  insights: Insight[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const present = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The extreme a rule cares about: the low end for min limits, the high end for max limits. */
export function worstValue(rule: Rule, extremes: Record<string, [number, number]>): number | null {
  const e = extremes[rule.metric];
  if (!e) return null;
  const low = rule.aggregate ? rule.aggregate === "min" : rule.max === null;
  return low ? e[0] : e[1];
}

export function analyze(config: ExerciseConfig, reps: RepResult[]): SetAnalysis {
  let partials = 0;
  const rows: RepRow[] = reps.map((rep) => ({
    label: rep.counted ? String(rep.index) : `P${++partials}`,
    rep,
    downS: rep.bottomS - rep.startS,
    upS: rep.endS - rep.bottomS,
    bottom: rep.extremes[config.primaryMetric]?.[0] ?? null,
    values: Object.fromEntries(config.rules.map((r) => [r.id, worstValue(r, rep.extremes)])),
  }));

  const rules: RuleSeries[] = config.rules
    .filter((r) => r.min !== null || r.max !== null)
    .map((rule) => ({
      rule,
      info: metricInfo(rule.metric),
      limit: (rule.max ?? rule.min)!,
      faultSide: rule.max !== null ? "above" : "below",
      // Partial reps end before the rules are checked, so they'd only add noise here.
      points: rows.filter((row) => !row.rep.faults.includes("partial")).map((row) => ({
        label: row.label,
        value: row.values[rule.id],
        faulted: row.rep.faults.includes(rule.id),
      })),
    }));

  return { rows, rules, insights: insights(config, rows) };
}

function insights(config: ExerciseConfig, rows: RepRow[]): Insight[] {
  const out: Insight[] = [];
  const counted = rows.filter((r) => r.rep.counted);
  const partials = rows.filter((r) => r.rep.faults.includes("partial")).length;
  if (partials > 0) {
    out.push({ tone: "warn", text: `${plural(partials, "rep")} didn't go deep enough to count.` });
  }
  for (const rule of config.rules.filter((r) => r.noRep)) {
    const blocked = rows.filter((r) => !r.rep.counted && r.rep.faults.includes(rule.id)).length;
    if (blocked > 0) out.push({ tone: "warn", text: `${plural(blocked, "rep")} didn't count: "${rule.cue}".` });
  }
  if (counted.length === 0) {
    if (rows.length === 0) out.push({ tone: "info", text: "No reps recorded. Check that your whole body is in frame." });
    return out;
  }

  for (const rule of config.rules) {
    const info = metricInfo(rule.metric);
    const measured = counted.filter((r) => r.values[rule.id] !== null).length;
    const faulted = counted.filter((r) => r.rep.faults.includes(rule.id)).length;
    if (measured === 0) {
      out.push({ tone: "info", text: `${info.label} wasn't measured. ${info.hint ?? ""}`.trim() });
    } else if (faulted * 2 >= counted.length) {
      out.push({ tone: "warn", text: `"${rule.cue}" on ${faulted} of ${counted.length} reps: your main thing to fix.` });
    } else if (faulted === 0) {
      out.push({ tone: "good", text: `${info.label} stayed within the limit on every rep.` });
    }
  }

  const bottoms = present(counted.map((r) => r.bottom));
  const unit = metricInfo(config.primaryMetric).unit;
  if (bottoms.length >= 4) {
    // The primary metric drops into the rep, so a higher bottom is a shallower rep.
    const k = Math.max(2, Math.floor(bottoms.length / 3));
    const drift = mean(bottoms.slice(-k)) - mean(bottoms.slice(0, k));
    if (drift >= 8) {
      out.push({ tone: "warn", text: `Depth faded as the set went on: your last ${k} reps were ${drift.toFixed(0)}${unit} shallower than your first ${k}.` });
    } else if (drift <= -8) {
      out.push({ tone: "info", text: `You got ${(-drift).toFixed(0)}${unit} deeper as the set went on. A longer warm-up may help.` });
    }
  }
  if (bottoms.length >= 3) {
    const spread = sd(bottoms);
    if (spread <= 4) out.push({ tone: "good", text: `Very consistent depth (±${spread.toFixed(0)}${unit} between reps).` });
    else if (spread >= 10) out.push({ tone: "warn", text: `Depth varied a lot between reps (±${spread.toFixed(0)}${unit}). Aim for the same depth every time.` });
  }

  const down = mean(counted.map((r) => r.downS));
  if (down < 1) {
    out.push({ tone: "warn", text: `Fast descent (${down.toFixed(1)} s on average). Try a controlled 2–3 s lowering.` });
  }
  if (counted.length >= 4) {
    const k = Math.max(2, Math.floor(counted.length / 3));
    const first = mean(counted.slice(0, k).map((r) => r.upS));
    const last = mean(counted.slice(-k).map((r) => r.upS));
    if (last - first >= 0.3 && last / first >= 1.3) {
      out.push({ tone: "info", text: `Standing up slowed by ${((last / first - 1) * 100).toFixed(0)}% near the end, a sign you were close to fatigue.` });
    }
  }

  if (bottoms.length >= 2) {
    const deepest = counted.reduce((a, b) => ((b.bottom ?? Infinity) < (a.bottom ?? Infinity) ? b : a));
    out.push({ tone: "good", text: `Deepest rep: #${deepest.label} at ${deepest.bottom!.toFixed(0)}${unit}.` });
  }

  const order = { warn: 0, good: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
