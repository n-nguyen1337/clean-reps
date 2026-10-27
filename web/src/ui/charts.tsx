// Small hand-rolled SVG charts for the summary screen. Each chart measures its
// container so text renders at real pixel sizes, and shows a tooltip on hover.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { metricInfo, type RepRow, type RuleSeries } from "../engine/analysis";
import type { TracePoint } from "../engine/session";

const M = { top: 22, right: 12, bottom: 26, left: 40 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(span: number, count: number): number {
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

/** A padded domain that snaps to clean tick values. */
function niceDomain(values: number[], count = 4, floorZero = false): { lo: number; hi: number; ticks: number[] } {
  let lo = floorZero ? 0 : Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, count);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

const fmt = (v: number, unit: string) => unit === "°" ? `${v.toFixed(0)}°` : unit === "s" ? `${v.toFixed(1)} s` : v.toFixed(2);

interface Tip { x: number; y: number; content: ReactNode }

function Frame({ title, subtitle, legend, height, tip, children, width, frameRef }: {
  title: string; subtitle?: string; legend?: ReactNode; height: number; tip: Tip | null;
  children: ReactNode; width: number; frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <figure className="chart">
      <figcaption>
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </figcaption>
      {legend && <div className="legend">{legend}</div>}
      <div className="chart-body" ref={frameRef}>
        <svg width={width} height={height} role="img" aria-label={title}>{children}</svg>
        {tip && (
          <div className="tooltip" style={{ left: Math.min(Math.max(tip.x, 70), width - 70), top: tip.y }}>{tip.content}</div>
        )}
      </div>
    </figure>
  );
}

function YAxis({ ticks, y, width, unit }: { ticks: number[]; y: (v: number) => number; width: number; unit: string }) {
  return (
    <g className="axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="grid" />
          <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{fmt(t, unit)}</text>
        </g>
      ))}
    </g>
  );
}

/** Reference line across the plot with a label at its right end. */
function RefLine({ y, width, label, tone }: { y: number; width: number; label: string; tone?: "warn" }) {
  return (
    <g className={`ref ${tone ?? ""}`}>
      <line x1={M.left} x2={width - M.right} y1={y} y2={y} />
      <text x={width - M.right - 4} y={y - 5} textAnchor="end">{label}</text>
    </g>
  );
}

// ---------------------------------------------------------------------------

/** The primary metric over the whole set, with each rep shaded behind it. */
export function TraceChart({ trace, metric, rows, refs }: {
  trace: TracePoint[]; metric: string; rows: RepRow[]; refs: { value: number; label: string; tone?: "warn" }[];
}) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const info = metricInfo(metric);
  const height = 220;

  const pts = trace.map((p) => ({ t: p.t, v: p.metrics[metric] ?? null }))
    .filter((p): p is { t: number; v: number } => p.v !== null && !Number.isNaN(p.v));
  if (pts.length < 2) return null;

  const t0 = trace[0].t, t1 = trace[trace.length - 1].t;
  const x = (t: number) => M.left + ((t - t0) / Math.max(t1 - t0, 1e-6)) * (width - M.left - M.right);
  const dom = niceDomain([...pts.map((p) => p.v), ...refs.map((r) => r.value)]);
  const y = (v: number) => M.top + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (height - M.top - M.bottom);

  // Break the line where tracking dropped out for more than half a second.
  let d = "";
  pts.forEach((p, i) => {
    const gap = i === 0 || p.t - pts[i - 1].t > 0.5;
    d += `${gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  const timeTicks = niceDomain([0, t1 - t0], 5, true).ticks.filter((s) => s <= t1 - t0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i;
    const p = pts[best];
    const row = rows.find((r) => p.t >= r.rep.startS && p.t <= r.rep.endS);
    setHover(best);
    setTip({
      x: x(p.t), y: y(p.v),
      content: <><b>{fmt(p.v, info.unit)}</b> at {(p.t - t0).toFixed(1)} s{row && <><br />Rep {row.label}</>}</>,
    });
  };

  return (
    <Frame frameRef={ref} width={width} height={height} tip={tip}
      title={`${info.label} over the set`} subtitle="Each shaded band is one rep. Dips below the lines count and pass depth.">
      <YAxis ticks={dom.ticks} y={y} width={width} unit={info.unit} />
      {rows.map((r) => {
        const faulted = r.rep.faults.length > 0;
        return (
          <g key={r.label}>
            <rect className="band" x={x(r.rep.startS)} y={M.top} width={Math.max(x(r.rep.endS) - x(r.rep.startS), 1)} height={height - M.top - M.bottom} />
            <text className={`band-label ${faulted ? "warn" : ""}`} x={(x(r.rep.startS) + x(r.rep.endS)) / 2} y={M.top - 7} textAnchor="middle">
              {r.label}{faulted ? "!" : ""}
            </text>
          </g>
        );
      })}
      {refs.map((r) => <RefLine key={r.label} y={y(r.value)} width={width} label={r.label} tone={r.tone} />)}
      <g className="axis">
        {timeTicks.map((s) => (
          <text key={s} x={x(t0 + s)} y={height - 8} textAnchor="middle">{s}s</text>
        ))}
      </g>
      <path d={d} className="series-line s1" />
      {hover !== null && (
        <g>
          <line className="crosshair" x1={x(pts[hover].t)} x2={x(pts[hover].t)} y1={M.top} y2={height - M.bottom} />
          <circle className="dot s1" cx={x(pts[hover].t)} cy={y(pts[hover].v)} r={5} />
        </g>
      )}
      <rect x={M.left} y={0} width={width - M.left - M.right} height={height} fill="transparent"
        onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHover(null); }} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------

/** Band layout shared by the per-rep charts. */
function repBands(n: number, width: number) {
  const band = (width - M.left - M.right) / Math.max(n, 1);
  const every = Math.ceil(n / Math.max(1, Math.floor((width - M.left - M.right) / 28)));
  return { band, cx: (i: number) => M.left + band * (i + 0.5), showLabel: (i: number) => i % every === 0 };
}

/** One rule's worst value per rep against its limit; flagged reps are marked. */
export function RuleChart({ series }: { series: RuleSeries }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const { info, limit, faultSide, points, rule } = series;
  const height = 180;

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const dom = niceDomain([...values, limit]);
  const y = (v: number) => M.top + (1 - (v - dom.lo) / (dom.hi - dom.lo)) * (height - M.top - M.bottom);
  const { band, cx, showLabel } = repBands(points.length, width);

  let d = "";
  points.forEach((p, i) => {
    if (p.value === null) return;
    d += `${d ? "L" : "M"}${cx(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  const zoneTop = faultSide === "above" ? M.top : y(limit);
  const zoneBottom = faultSide === "above" ? y(limit) : height - M.bottom;
  const better = faultSide === "above" ? "lower is better" : "higher is better";

  return (
    <Frame frameRef={ref} width={width} height={height} tip={tip}
      title={`${info.label} per rep`} subtitle={`Worst point of each rep; ${better}. "${rule.cue}" when it crosses the line.`}>
      <YAxis ticks={dom.ticks} y={y} width={width} unit={info.unit} />
      <rect className="fault-zone" x={M.left} y={zoneTop} width={width - M.left - M.right} height={Math.max(zoneBottom - zoneTop, 0)} />
      <RefLine y={y(limit)} width={width} label={`limit ${fmt(limit, info.unit)}`} tone="warn" />
      <path d={d} className="series-line s1 faint" />
      {points.map((p, i) => (
        <g key={p.label}>
          {showLabel(i) && <text className="axis-label" x={cx(i)} y={height - 8} textAnchor="middle">{p.label}</text>}
          {p.value !== null && (
            <>
              <circle className={`dot ${p.faulted ? "flagged" : "s1"}`} cx={cx(i)} cy={y(p.value)} r={p.faulted ? 6 : 5} />
              {p.faulted && <text className="flag" x={cx(i)} y={y(p.value) - 11} textAnchor="middle">!</text>}
              <circle cx={cx(i)} cy={y(p.value)} r={Math.max(12, Math.min(band / 2, 18))} fill="transparent"
                onPointerEnter={() => setTip({
                  x: cx(i), y: y(p.value!),
                  content: <><b>Rep {p.label}</b>: {fmt(p.value!, info.unit)}<br />{p.faulted ? `Flagged: ${rule.cue}` : "Within limit"}</>,
                })}
                onPointerLeave={() => setTip(null)} />
            </>
          )}
        </g>
      ))}
    </Frame>
  );
}

// ---------------------------------------------------------------------------

/** Rect with only its top corners rounded: the data end of a column. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Seconds down and seconds up per rep, stacked. */
export function TempoChart({ rows }: { rows: RepRow[] }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const height = 180;
  if (rows.length === 0) return null;

  const dom = niceDomain(rows.map((r) => r.downS + r.upS), 4, true);
  const y = (v: number) => M.top + (1 - v / dom.hi) * (height - M.top - M.bottom);
  const { band, cx, showLabel } = repBands(rows.length, width);
  const barW = Math.min(24, band * 0.6);
  const gap = 2;

  return (
    <Frame frameRef={ref} width={width} height={height} tip={tip}
      title="Tempo per rep" subtitle="Seconds lowering and standing up."
      legend={<><span><i className="swatch s1" />Down</span><span><i className="swatch s2" />Up</span></>}>
      <YAxis ticks={dom.ticks} y={y} width={width} unit="s" />
      {rows.map((r, i) => {
        const x0 = cx(i) - barW / 2;
        const downTop = y(r.downS);
        const upTop = y(r.downS + r.upS);
        return (
          <g key={r.label}>
            {showLabel(i) && <text className="axis-label" x={cx(i)} y={height - 8} textAnchor="middle">{r.label}</text>}
            <rect className="bar s1" x={x0} y={downTop} width={barW} height={Math.max(y(0) - downTop, 0)} />
            <path className="bar s2" d={topRounded(x0, upTop, barW, Math.max(downTop - upTop - gap, 0), 4)} />
            <rect x={cx(i) - band / 2} y={M.top} width={band} height={height - M.top - M.bottom} fill="transparent"
              onPointerEnter={() => setTip({
                x: cx(i), y: upTop,
                content: <><b>Rep {r.label}</b><br />{r.downS.toFixed(1)} s down · {r.upS.toFixed(1)} s up</>,
              })}
              onPointerLeave={() => setTip(null)} />
          </g>
        );
      })}
    </Frame>
  );
}
