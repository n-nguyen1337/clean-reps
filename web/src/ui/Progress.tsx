import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { metricInfo } from "../engine/analysis";
import type { Progression } from "../store/achievements";
import { exportHistory } from "../store/db";
import { bestSet, setPoints, weeklyTotals, weekStreak } from "../store/progress";
import type { SetRecord } from "../store/record";
import { AchievementTeaser, LevelCard } from "./Achievements";
import { shortDate, TrendChart, WeeklyChart } from "./charts";
import { RepStrip } from "./RepStrip";

const topFault = (set: SetRecord): string | null => {
  const [id] = Object.entries(set.summary.faults).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!id) return null;
  return id === "partial" ? "Partial reps" : set.config.rules.find((r) => r.id === id)?.cue ?? id;
};

const HISTORY_SHOWN = 4;

function ExerciseProgress({ sets, level, achievements, onOpen }: {
  sets: SetRecord[]; level: ReactNode; achievements: ReactNode; onOpen: (set: SetRecord) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [showAll, setShowAll] = useState(false);
  const history = showAll ? sets : sets.slice(0, HISTORY_SHOWN);
  const points = useMemo(() => setPoints(sets).slice(-30), [sets]);
  const latest = sets[0];
  const primary = metricInfo(latest.config.primaryMetric);
  const best = bestSet(sets);
  const totalReps = sets.reduce((n, s) => n + s.summary.reps, 0);
  const streak = weekStreak(sets, now);
  const trend = (chart: ReactNode) => points.length < 2
    ? <p className="hint empty-chart">Trends appear after your second set.</p> : chart;

  return (
    <>
      <dl className="kpi-strip">
        <div><dt>Sets</dt><dd className="num">{sets.length}</dd></div>
        <div><dt>Counted reps</dt><dd className="num">{totalReps.toLocaleString()}</dd></div>
        <div><dt>Week streak</dt><dd className="num">{streak}<small> {streak === 1 ? "week" : "weeks"}</small></dd></div>
        <div>
          <dt>Best set</dt>
          <dd className="num">{best ? <>{best.summary.cleanReps}<small> clean, {shortDate(new Date(best.summary.started))}</small></> : <span className="dash">–</span>}</dd>
        </div>
      </dl>

      <div className="cols keep-order">
        <div className="col-main">
          <section className="panel p-clean">
            {trend(<TrendChart title="Clean reps" subtitle="Share of counted reps with no form faults, per set."
              unit="%" domain={[0, 100]} points={points.map((p) => ({ key: p.id, date: p.started, value: p.cleanPct }))} />)}
          </section>
          <section className="panel p-weekly">
            <WeeklyChart weeks={weeklyTotals(sets, now)} />
          </section>
          <section className="panel p-range">
            {trend(<TrendChart title={`Range of motion: ${primary.label.toLowerCase()}`}
              subtitle="Median lowest point of each set's reps; lower is a fuller rep."
              unit={primary.unit} points={points.map((p) => ({ key: p.id, date: p.started, value: p.depth }))}
              refLine={{ value: latest.config.bottomThreshold, label: `rep counts below ${latest.config.bottomThreshold}${primary.unit}` }} />)}
          </section>
          <section className="panel p-tempo">
            {trend(<TrendChart title="Lowering tempo" subtitle="Average seconds on the way down; 2–3 s is controlled."
              unit="s" points={points.map((p) => ({ key: p.id, date: p.started, value: p.avgDownS }))} />)}
          </section>
        </div>

        <aside className="col-side">
          {level}
          <section className="panel p-history">
            <div className="panel-head">
              <h2>History</h2>
              <span className="meta">{sets.length} {sets.length === 1 ? "set" : "sets"}</span>
            </div>
            <ul className="history">
              {history.map((set) => {
                const s = set.summary;
                const fault = topFault(set);
                return (
                  <li key={set.id}>
                    <button onClick={() => onOpen(set)}>
                      <span className="history-line">
                        <b>{new Date(s.started).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>
                        <span className="num">{s.cleanReps}<span className="of"> / {s.reps}</span></span>
                      </span>
                      <RepStrip reps={set.reps} />
                      <span className="meta">{fault ?? "No faults"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {sets.length > HISTORY_SHOWN && (
              <button className="ghost show-all" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${sets.length} sets`}
              </button>
            )}
          </section>
          {achievements}
        </aside>
      </div>
    </>
  );
}

/** Small menu for page actions that don't need a permanent button. */
function MoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details ref={ref} className="menu">
      <summary className="icon-btn" aria-label="More actions">⋯</summary>
      <div className="menu-items" onClick={() => ref.current && (ref.current.open = false)}>{children}</div>
    </details>
  );
}

export function Progress({ sets, prog, onOpen, onAchievements }: {
  sets: SetRecord[] | null; prog: Progression | null;
  onOpen: (set: SetRecord) => void; onAchievements: () => void;
}) {
  const exercises = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sets ?? []) if (!seen.has(s.summary.exercise)) seen.set(s.summary.exercise, s.config.name);
    return [...seen]; // most recently trained first
  }, [sets]);
  const [picked, setPicked] = useState<string | null>(null);
  const exercise = picked && exercises.some(([k]) => k === picked) ? picked : exercises[0]?.[0];
  const ofExercise = useMemo(() => (sets ?? []).filter((s) => s.summary.exercise === exercise), [sets, exercise]);

  const level = prog && <LevelCard level={prog.level} unlocked={Object.keys(prog.unlocked).length} />;
  const achievements = prog && sets && (
    <section className="panel p-achievements">
      <AchievementTeaser prog={prog} sets={sets} onOpen={onOpen} onSeeAll={onAchievements} />
    </section>
  );

  return (
    <main className="page wide">
      <div className="title-row">
        <div>
          <h1>Progress</h1>
          {sets && sets.length > 0 && <p className="sub">Is your form getting cleaner? Every set you finish is charted here.</p>}
        </div>
        <div className="title-actions">
          {exercises.length > 1 && (
            <div className="segmented tabs" role="group" aria-label="Exercise">
              {exercises.map(([key, name]) => (
                <button key={key} className={key === exercise ? "selected" : ""} aria-pressed={key === exercise}
                  onClick={() => setPicked(key)}>{name}</button>
              ))}
            </div>
          )}
          {sets && sets.length > 0 && (
            <MoreMenu><button onClick={() => exportHistory()}>Export history (JSON)</button></MoreMenu>
          )}
        </div>
      </div>
      {sets === null ? null : sets.length === 0 ? (
        <div className="panel empty">
          <p className="lede">No sets yet. Finish a set and your reps, form trends and achievements will show up here.</p>
          <a className="button primary" href="#/">Start your first set</a>
        </div>
      ) : (
        <ExerciseProgress key={exercise} sets={ofExercise} level={level} achievements={achievements} onOpen={onOpen} />
      )}
    </main>
  );
}
