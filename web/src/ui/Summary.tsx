import { useMemo, useRef, useState, type ReactNode } from "react";
import type { CoachReport } from "../ai/coach";
import { getClient, useAccount } from "../cloud/account";
import { analyze, metricInfo } from "../engine/analysis";
import type { SessionRecord } from "../engine/session";
import type { Playback } from "../playback/playback";
import type { SetRecord } from "../store/record";
import { RuleChart, shortDate, TempoChart, TraceChart } from "./charts";
import { Player, type PlayerHandle } from "./Player";
import { RepStrip } from "./RepStrip";

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
            {r.strengths.map((s) => <li key={s} className="good"><i aria-hidden="true" />{s}</li>)}
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

export function Summary({ record, previous, playback, progress, back, children }: {
  record: SessionRecord; previous?: SetRecord | null;
  /** The set's recording, right after it ends. Past sets have none. */
  playback?: Playback | null;
  /** XP, level and achievements the set earned. */
  progress?: ReactNode;
  /** Link back to where the user came from, shown above the title. */
  back?: ReactNode;
  children: ReactNode;
}) {
  const account = useAccount();
  const player = useRef<PlayerHandle>(null);
  const replay = useRef<HTMLElement>(null);
  const [replayT, setReplayT] = useState<number | null>(null);
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

  // With a replay, tapping a rep anywhere on the page plays it.
  const reveal = () => replay.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const playRow = (row: (typeof analysis.rows)[number] | undefined) => {
    if (!row) return;
    player.current?.playRep(row);
    reveal();
  };
  const playRep = playback ? (label: string) => playRow(analysis.rows.find((r) => r.label === label)) : undefined;
  const playFault = playback ? (id: string) => playRow(analysis.rows.find((r) => r.rep.faults.includes(id))) : undefined;
  const seek = playback ? (t: number) => { player.current?.seek(t); reveal(); } : undefined;

  // Every chart shows on wider screens; a phone shows one at a time, opening on the most frequent fault's.
  const charts = [
    ...record.trace.length > 1 ? [{
      id: "trace", label: "Whole set", faults: 0,
      node: <TraceChart trace={record.trace} metric={cfg.primaryMetric} rows={analysis.rows} refs={refs} cursor={replayT} onSeek={seek} />,
    }] : [],
    ...charted.map((series) => ({
      id: series.rule.id, label: series.rule.cue, faults: s.faults[series.rule.id] ?? 0,
      node: <RuleChart series={series} onSelect={playRep} />,
    })),
    { id: "tempo", label: "Tempo", faults: 0, node: <TempoChart rows={analysis.rows} onSelect={playRep} /> },
  ];
  const [pickedChart, setPickedChart] = useState<string | null>(null);
  const shownChart = charts.find((c) => c.id === pickedChart)?.id
    ?? charts.find((c) => c.id === faults[0]?.[0])?.id ?? charts[0].id;

  const started = new Date(s.started);

  return (
    <main className="page wide summary">
      {back}
      <div className="title-row">
        <div>
          <h1>{cfg.name}</h1>
          <p className="sub">
            {started.toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <div className="title-actions">{children}</div>
      </div>

      <section className="panel lead">
        <div className="lead-figure">
          <p className="figure"><b className="num">{s.cleanReps}</b><span> of {s.reps} reps clean</span></p>
          {previous && <SinceLast current={s} previous={previous} />}
        </div>
        <RepStrip reps={record.reps} size="large" legend />
        <dl className="kpi-strip flat">
          <div><dt>Counted</dt><dd className="num">{s.reps}</dd></div>
          <div><dt>Clean</dt><dd className="num">{s.cleanReps}</dd></div>
          <div><dt>Not counted</dt><dd className="num">{s.partialReps}</dd></div>
          <div>
            <dt>Tempo, down / up</dt>
            <dd className="num">{s.avgDownS !== null && s.avgUpS !== null
              ? <>{s.avgDownS.toFixed(1)}<small> s</small> / {s.avgUpS.toFixed(1)}<small> s</small></>
              : <span className="dash">–</span>}</dd>
          </div>
        </dl>
      </section>

      <div className="cols">
        <div className="col-main">
          {playback && (
            <section ref={replay} className="panel replay-section">
              <h2>Replay</h2>
              <Player ref={player} playback={playback} rows={analysis.rows} trace={record.trace}
                metric={cfg.primaryMetric} faultLabel={label} onTime={setReplayT} />
            </section>
          )}

          {analysis.rows.length > 0 && (
            <>
              {charts.length > 1 && (
                <div className="chart-picker" role="group" aria-label="Show chart">
                  {charts.map((c) => (
                    <button key={c.id} className={c.id === shownChart ? "selected" : ""} aria-pressed={c.id === shownChart}
                      onClick={() => setPickedChart(c.id)}>
                      {c.faults > 0 && <i className="fault-dot" aria-label={`${c.faults} flagged`} />}{c.label}
                    </button>
                  ))}
                </div>
              )}
              {charts.map((c) => (
                <section key={c.id} className={`panel chart-panel${c.id === shownChart ? " shown" : ""}`}>{c.node}</section>
              ))}

              <details className="panel rep-table">
                <summary>Rep-by-rep table</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">Rep</th><th className="num">Down</th><th className="num">Up</th>
                        {analysis.rules.map((r) => <th key={r.rule.id} className="num">{r.info.label}</th>)}
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.rows.map((row) => (
                        <tr key={row.label} className={playRep ? "clickable" : undefined}
                          onClick={playRep && (() => playRep(row.label))}>
                          <td className="num">{row.label}</td>
                          <td className="num">{row.downS.toFixed(1)} s</td>
                          <td className="num">{row.upS.toFixed(1)} s</td>
                          {analysis.rules.map((r) => {
                            const v = row.values[r.rule.id];
                            return <td key={r.rule.id} className="num">{v === null ? <span className="dash">–</span> : r.info.unit === "°" ? `${v.toFixed(0)}°` : v.toFixed(2)}</td>;
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
        </div>

        <aside className="col-side">
          <section className="panel">
            <h2>What to work on</h2>
            {faults.length > 0 ? (
              <ul className="faults">
                {faults.map(([id, n]) => (
                  <li key={id}>
                    {playFault
                      ? <button onClick={() => playFault(id)}><span>{label(id)}</span><b className="num">{n}× <small>Watch</small></b></button>
                      : <><span>{label(id)}</span><b className="num">{n}×</b></>}
                  </li>
                ))}
              </ul>
            ) : <p className="hint">No faults in this set.</p>}
          </section>

          {analysis.insights.length > 0 && (
            <section className="panel">
              <h2>Takeaways</h2>
              <ul className="insights">
                {analysis.insights.map((i) => <li key={i.text} className={i.tone}><i aria-hidden="true" />{i.text}</li>)}
              </ul>
            </section>
          )}

          {analysis.rows.length > 0 && account.configured && (
            <section className="panel">
              <h2>AI coach</h2>
              <CoachSection record={record} analysis={analysis} />
            </section>
          )}

          {progress}
        </aside>
      </div>
    </main>
  );
}
