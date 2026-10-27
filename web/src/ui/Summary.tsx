import { useMemo, useState, type ReactNode } from "react";
import type { CoachReport } from "../ai/coach";
import { getClient, useAccount } from "../cloud/account";
import { analyze, metricInfo } from "../engine/analysis";
import type { SessionRecord } from "../engine/session";
import type { SetRecord } from "../store/record";
import { RuleChart, shortDate, TempoChart, TraceChart } from "./charts";

const ICON = { warn: "!", good: "✓", info: "i" } as const;

type Coach = { kind: "idle" } | { kind: "loading" } | { kind: "done"; report: CoachReport; remaining: number }
  | { kind: "error"; message: string };

function CoachSection({ record, analysis }: { record: SessionRecord; analysis: ReturnType<typeof analyze> }) {
  const account = useAccount();
  const [coach, setCoach] = useState<Coach>({ kind: "idle" });

  const run = async () => {
    setCoach({ kind: "loading" });
    try {
      const [{ getCoaching }, client] = await Promise.all([import("../ai/coach"), getClient()]);
      setCoach({ kind: "done", ...await getCoaching(client, record, analysis) });
    } catch (err) {
      setCoach({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (coach.kind === "done") {
    const r = coach.report;
    return (
      <section className="coach">
        <p className="coach-headline">{r.headline}</p>
        <p>{r.assessment}</p>
        {r.strengths.length > 0 && (
          <ul className="insights">
            {r.strengths.map((s) => <li key={s} className="good"><i>{ICON.good}</i>{s}</li>)}
          </ul>
        )}
        {r.fixes.map((f, i) => (
          <div key={i} className="fix">
            <b>{i + 1}. {f.issue}</b>
            <p>{f.why}</p>
            <p><span className="tag">Cue</span>{f.cue}</p>
            <p><span className="tag">Drill</span>{f.drill}</p>
          </div>
        ))}
        <p><span className="tag">Next set</span>{r.next_set}</p>
        <p className="hint small">
          AI-generated from pose estimates. Not medical advice. {coach.remaining} {coach.remaining === 1 ? "review" : "reviews"} left today.
        </p>
      </section>
    );
  }

  if (account.status !== "signed-in") {
    return (
      <section className="coach">
        <p>Sign in to get a written review of this set from Claude, with cues and drills for your next one.</p>
        <button className="primary" disabled={account.status === "loading"}
          onClick={() => account.signIn().catch((err) => setCoach({ kind: "error", message: String(err) }))}>
          Sign in with Google
        </button>
        {coach.kind === "error" && <p className="error">{coach.message}</p>}
      </section>
    );
  }

  return (
    <section className="coach">
      <button className="primary" disabled={coach.kind === "loading"} onClick={run}>
        {coach.kind === "loading" ? "Analysing your set…" : "Get AI coaching"}
      </button>
      {coach.kind === "error" && <p className="error">{coach.message}</p>}
      <p className="hint small">Only this set's numbers are sent, never video.</p>
    </section>
  );
}

/** "Last time" line comparing with the previous set of the same exercise. */
function SinceLast({ current, previous }: { current: SessionRecord["summary"]; previous: SetRecord }) {
  const p = previous.summary;
  const diff = current.cleanReps - p.cleanReps;
  return (
    <p className="since-last">
      Last time ({shortDate(new Date(p.started))}): {p.reps} reps, {p.cleanReps} clean.
      {diff !== 0 && <b className={diff > 0 ? "up" : "down"}> {diff > 0 ? `+${diff}` : diff} clean reps</b>}
    </p>
  );
}

export function Summary({ record, previous, children }: {
  record: SessionRecord; previous?: SetRecord | null; children: ReactNode;
}) {
  const account = useAccount();
  const { summary: s, config: cfg } = record;
  const analysis = useMemo(() => analyze(cfg, record.reps), [cfg, record.reps]);
  const label = (id: string) => id === "partial" ? "Partial reps" : cfg.rules.find((r) => r.id === id)?.cue ?? id;
  const faults = Object.entries(s.faults).sort((a, b) => b[1] - a[1]);
  const primary = metricInfo(cfg.primaryMetric);
  const refs = [
    { value: cfg.bottomThreshold, label: `rep counts below ${cfg.bottomThreshold}${primary.unit}` },
    ...cfg.rules.filter((r) => r.metric === cfg.primaryMetric && r.max !== null)
      .map((r) => ({ value: r.max!, label: `${r.id} limit ${r.max}${primary.unit}`, tone: "warn" as const })),
  ];
  const charted = analysis.rules.filter((r) => r.points.some((p) => p.value !== null));

  return (
    <main className="page">
      <h1>{cfg.name}</h1>
      <div className="stats">
        <div><b>{s.reps}</b><span>reps</span></div>
        <div><b>{s.cleanReps}</b><span>clean</span></div>
        <div><b>{s.partialReps}</b><span>partial</span></div>
      </div>
      {s.avgDownS !== null && <p>Tempo: {s.avgDownS}s down / {s.avgUpS}s up</p>}
      {previous && <SinceLast current={s} previous={previous} />}

      {analysis.insights.length > 0 && (
        <>
          <h2>Takeaways</h2>
          <ul className="insights">
            {analysis.insights.map((i) => <li key={i.text} className={i.tone}><i>{ICON[i.tone]}</i>{i.text}</li>)}
          </ul>
        </>
      )}

      {analysis.rows.length > 0 && (
        <>
          {account.configured && (
            <>
              <h2>AI coach</h2>
              <CoachSection record={record} analysis={analysis} />
            </>
          )}

          <h2>Charts</h2>
          <TraceChart trace={record.trace} metric={cfg.primaryMetric} rows={analysis.rows} refs={refs} />
          {charted.map((series) => <RuleChart key={series.rule.id} series={series} />)}
          <TempoChart rows={analysis.rows} />

          <details className="rep-table">
            <summary>Rep-by-rep table</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rep</th><th>Down</th><th>Up</th>
                    {analysis.rules.map((r) => <th key={r.rule.id}>{r.info.label}</th>)}
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.downS.toFixed(1)} s</td>
                      <td>{row.upS.toFixed(1)} s</td>
                      {analysis.rules.map((r) => {
                        const v = row.values[r.rule.id];
                        return <td key={r.rule.id}>{v === null ? "–" : r.info.unit === "°" ? `${v.toFixed(0)}°` : v.toFixed(2)}</td>;
                      })}
                      <td>{row.rep.faults.length ? row.rep.faults.map(label).join(", ") : "Clean"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {faults.length > 0 && (
        <>
          <h2>What to work on</h2>
          <ul className="faults">
            {faults.map(([id, n]) => <li key={id}><span>{label(id)}</span><b>{n}×</b></li>)}
          </ul>
        </>
      )}
      <div className="row">{children}</div>
    </main>
  );
}
