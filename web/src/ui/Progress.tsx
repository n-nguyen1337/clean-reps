import { useMemo, useState } from "react";
import { metricInfo } from "../engine/analysis";
import type { Progression } from "../store/achievements";
import { exportHistory } from "../store/db";
import { bestSet, setPoints, weeklyTotals, weekStreak } from "../store/progress";
import type { SetRecord } from "../store/record";
import { AchievementTeaser, LevelCard } from "./Achievements";
import { shortDate, TrendChart, WeeklyChart } from "./charts";

const topFault = (set: SetRecord): string | null => {
  const [id] = Object.entries(set.summary.faults).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!id) return null;
  return id === "partial" ? "Partial reps" : set.config.rules.find((r) => r.id === id)?.cue ?? id;
};

function ExerciseProgress({ sets, onOpen }: { sets: SetRecord[]; onOpen: (set: SetRecord) => void }) {
  const now = useMemo(() => new Date(), []);
  const points = useMemo(() => setPoints(sets).slice(-30), [sets]);
  const latest = sets[0];
  const primary = metricInfo(latest.config.primaryMetric);
  const best = bestSet(sets);
  const totalReps = sets.reduce((n, s) => n + s.summary.reps, 0);

  return (
    <>
      <div className="stats">
        <div><b>{sets.length}</b><span>{sets.length === 1 ? "set" : "sets"}</span></div>
        <div><b>{totalReps}</b><span>reps</span></div>
        <div><b>{weekStreak(sets, now)}</b><span>week streak</span></div>
      </div>
      {best && (
        <p className="since-last">
          Best set: <b>{best.summary.cleanReps} clean reps</b> on {shortDate(new Date(best.summary.started))}
        </p>
      )}

      <h2>Trends</h2>
      <WeeklyChart weeks={weeklyTotals(sets, now)} />
      <TrendChart title="Clean reps" subtitle="Share of counted reps with no form faults, per set."
        unit="%" domain={[0, 100]} points={points.map((p) => ({ key: p.id, date: p.started, value: p.cleanPct }))} />
      <TrendChart title={`Range of motion: ${primary.label.toLowerCase()}`}
        subtitle="Median lowest point of each set's reps; lower is a fuller rep."
        unit={primary.unit} points={points.map((p) => ({ key: p.id, date: p.started, value: p.depth }))}
        refLine={{ value: latest.config.bottomThreshold, label: `rep counts below ${latest.config.bottomThreshold}${primary.unit}` }} />
      <TrendChart title="Lowering tempo" subtitle="Average seconds on the way down; 2–3 s is controlled."
        unit="s" points={points.map((p) => ({ key: p.id, date: p.started, value: p.avgDownS }))} />
      {points.length < 2 && <p className="hint">Trend charts appear after your second set.</p>}

      <h2>History</h2>
      <ul className="history">
        {sets.map((set) => {
          const s = set.summary;
          const fault = topFault(set);
          return (
            <li key={set.id}>
              <button onClick={() => onOpen(set)}>
                <span className="when">
                  {new Date(s.started).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
                <b>{s.reps} reps · {s.cleanReps} clean</b>
                <span>{fault ?? "No faults"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Progress({ sets, prog, onOpen, onAchievements, onBack }: {
  sets: SetRecord[] | null; prog: Progression | null;
  onOpen: (set: SetRecord) => void; onAchievements: () => void; onBack: () => void;
}) {
  const exercises = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sets ?? []) if (!seen.has(s.summary.exercise)) seen.set(s.summary.exercise, s.config.name);
    return [...seen]; // most recently trained first
  }, [sets]);
  const [picked, setPicked] = useState<string | null>(null);
  const exercise = picked && exercises.some(([k]) => k === picked) ? picked : exercises[0]?.[0];
  const ofExercise = useMemo(() => (sets ?? []).filter((s) => s.summary.exercise === exercise), [sets, exercise]);

  return (
    <main className="page">
      <h1>Progress</h1>
      {sets === null ? null : sets.length === 0 ? (
        <p className="lede">No sets yet. Finish a set and it will show up here.</p>
      ) : (
        <>
          {prog && (
            <>
              <LevelCard level={prog.level} unlocked={Object.keys(prog.unlocked).length} />
              <AchievementTeaser prog={prog} sets={sets} onOpen={onOpen} onSeeAll={onAchievements} />
              <h2>Exercises</h2>
            </>
          )}
          {exercises.length > 1 && (
            <div className="segmented" style={{ gridTemplateColumns: `repeat(${exercises.length}, 1fr)` }}>
              {exercises.map(([key, name]) => (
                <button key={key} className={key === exercise ? "selected" : ""} onClick={() => setPicked(key)}>{name}</button>
              ))}
            </div>
          )}
          <ExerciseProgress key={exercise} sets={ofExercise} onOpen={onOpen} />
        </>
      )}
      <div className="row">
        <button className="primary" onClick={onBack}>Back</button>
        {sets && sets.length > 0 && <button className="ghost" onClick={() => exportHistory()}>Export JSON</button>}
      </div>
    </main>
  );
}
