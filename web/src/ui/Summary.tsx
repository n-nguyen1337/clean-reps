import { useMemo, useState } from "react";
import type { CoachReport } from "../ai/coach";
import { loadApiKey, saveApiKey } from "../ai/key";
import { analyze, metricInfo } from "../engine/analysis";
import type { SessionRecord } from "../engine/session";
import { RuleChart, TempoChart, TraceChart } from "./charts";

const ICON = { warn: "!", good: "✓", info: "i" } as const;

type Coach = { kind: "idle" } | { kind: "loading" } | { kind: "done"; report: CoachReport } | { kind: "error"; message: string };

export function ApiKeyField({ onChange }: { onChange?: (key: string) => void }) {
  const [key, setKey] = useState(loadApiKey);
  return (
    <label className="key-field">
      <span>Anthropic API key (optional, for AI coaching)</span>
      <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key}
        onChange={(e) => {
          const next = e.target.value.trim();
          setKey(next);
          saveApiKey(next);
          onChange?.(next);
        }} />
      <small>Stored only in this browser. Only your set's numbers are sent, straight to Anthropic, never video.</small>
    </label>
  );
}

function CoachSection({ record, analysis }: { record: SessionRecord; analysis: ReturnType<typeof analyze> }) {
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [coach, setCoach] = useState<Coach>({ kind: "idle" });

  const run = async () => {
    setCoach({ kind: "loading" });
    try {
      // Loaded on demand so the SDK isn't in the main bundle.
      const { getCoaching } = await import("../ai/coach");
      setCoach({ kind: "done", report: await getCoaching(apiKey, record, analysis) });
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
        <p className="hint small">AI-generated from pose estimates. Not medical advice.</p>
      </section>
    );
  }

  return (
    <section className="coach">
      {!apiKey && <ApiKeyField onChange={setApiKey} />}
      <button className="primary" disabled={!apiKey || coach.kind === "loading"} onClick={run}>
        {coach.kind === "loading" ? "Analysing your set…" : "Get AI coaching"}
      </button>
      {coach.kind === "error" && <p className="error">{coach.message}</p>}
      <p className="hint small">Uses Claude Haiku with your own API key; a review costs about a tenth of a cent.</p>
    </section>
  );
}

export function Summary({ record, onAgain, onPick }: { record: SessionRecord; onAgain: () => void; onPick: () => void }) {
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
          <h2>AI coach</h2>
          <CoachSection record={record} analysis={analysis} />

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
      <div className="row">
        <button className="primary" onClick={onAgain}>Go again</button>
        <button className="ghost" onClick={onPick}>Change exercise</button>
      </div>
    </main>
  );
}
