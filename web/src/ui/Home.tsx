import { useMemo } from "react";
import type { ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";
import { ACHIEVEMENTS, type Progression } from "../store/achievements";
import { weeklyTotals, weekStreak } from "../store/progress";
import type { SetRecord } from "../store/record";
import type { Settings } from "../store/settings";
import { LevelCard } from "./Achievements";
import { Logo } from "./Logo";
import { RepStrip } from "./RepStrip";

const STEPS = [
  { title: "Pick an exercise", text: "Squats or push-ups." },
  { title: "Prop up your camera", text: "Whole body in frame, a couple of metres back." },
  { title: "Train", text: "Reps are counted and form cues are spoken as you go." },
];

const DAY_MS = 86_400_000;

function relativeDay(d: Date, now: Date): string {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function settingsLine(s: Settings, usesBuild: boolean): string {
  const build = s.body.femur === "average" && s.body.torso === "average" ? "Average build" : "Custom build";
  return [
    usesBuild && build,
    s.voice ? "Voice on" : "Voice off",
    s.replay ? "Replay on" : "Replay off",
    s.model === "lite" ? "Lite model" : "Full model",
  ].filter(Boolean).join(" · ");
}

const topFault = (set: SetRecord): string | null => {
  const [id] = Object.entries(set.summary.faults).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!id) return null;
  return id === "partial" ? "Partial reps" : set.config.rules.find((r) => r.id === id)?.cue ?? id;
};

const EARLIER_SHOWN = 3;

function LastSet({ sets, now }: { sets: SetRecord[]; now: Date }) {
  const [set, ...rest] = sets;
  const s = set.summary;
  const fault = topFault(set);
  return (
    <section className="panel last-set">
      <div className="panel-head">
        <h2>Last set</h2>
        <a className="text-link" href={`#/set/${encodeURIComponent(set.id)}`}>Open</a>
      </div>
      <p className="figure"><b className="num">{s.cleanReps}</b><span> of {s.reps} reps clean</span></p>
      <RepStrip reps={set.reps} size="large" />
      <p className="meta">{set.config.name}, {relativeDay(new Date(s.started), now)}. {fault ? `Most often: ${fault.toLowerCase()}.` : "No faults."}</p>
      {rest.length > 0 && (
        <ul className="earlier" aria-label="Earlier sets">
          {rest.slice(0, EARLIER_SHOWN).map((e) => (
            <li key={e.id}>
              <a href={`#/set/${encodeURIComponent(e.id)}`}>
                <span className="earlier-name">{e.config.name}<span>{relativeDay(new Date(e.summary.started), now)}</span></span>
                <RepStrip reps={e.reps} />
                <span className="num">{e.summary.cleanReps}<span className="of"> / {e.summary.reps}</span></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Totals({ sets, prog, now }: { sets: SetRecord[]; prog: Progression | null; now: Date }) {
  const week = weeklyTotals(sets, now, 1)[0];
  const streak = weekStreak(sets, now);
  return (
    <dl className="kpi-strip">
      <div><dt>Reps this week</dt><dd className="num">{week?.reps ?? 0}</dd></div>
      <div><dt>Sets this week</dt><dd className="num">{week?.sets ?? 0}</dd></div>
      <div><dt>Week streak</dt><dd className="num">{streak}<small> {streak === 1 ? "week" : "weeks"}</small></dd></div>
      <div><dt>Achievements</dt><dd className="num">{prog ? Object.keys(prog.unlocked).length : 0}<small> / {ACHIEVEMENTS.length}</small></dd></div>
    </dl>
  );
}

function FirstRun() {
  return (
    <section className="first-run">
      <ul className="steps">
        {STEPS.map((s) => <li key={s.title}><b>{s.title}</b><span>{s.text}</span></li>)}
      </ul>
    </section>
  );
}

export function Home({ sets, prog, configs, exercise, onExercise, settings, onStart }: {
  sets: SetRecord[] | null; prog: Progression | null; configs: Record<string, ExerciseConfig>;
  exercise: string; onExercise: (key: string) => void; settings: Settings; onStart: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const usesBuild = Object.keys(configs[exercise].proportions).length > 0;
  const returning = !!sets && sets.length > 0;

  return (
    <main className="page wide has-start home">
      <header className="app-header">
        <Logo />
      </header>

      <div className="title-row">
        <div>
          <h1>{returning ? "Welcome back" : "Every rep, counted and checked"}</h1>
          <p className="sub">
            {returning
              ? `${sets.length} ${sets.length === 1 ? "set" : "sets"} so far, saved on this device.`
              : "Prop up your phone and train. Pose tracking runs on this device, and video never leaves it."}
          </p>
        </div>
      </div>

      <div className="home-grid">
        <section className="panel next-set">
          <div className="panel-head">
            <h2>Next set</h2>
            <a className="text-link" href="#/about">How it works</a>
          </div>
          <div className="choices" role="radiogroup" aria-label="Exercise">
            {EXERCISE_KEYS.map((k) => (
              <button key={k} className={`choice ${k === exercise ? "selected" : ""}`} role="radio"
                aria-checked={k === exercise} onClick={() => onExercise(k)}>
                <b>{configs[k].name}</b>
                <span>{configs[k].cameraHint}</span>
              </button>
            ))}
          </div>
          <div className="next-foot">
            <a className="settings-summary" href="#/settings">
              <span>{settingsLine(settings, usesBuild)}</span>
              <span className="text-link">Change</span>
            </a>
            <div className="start-bar">
              <button className="primary big" onClick={onStart}>Start {configs[exercise].name.toLowerCase()}</button>
            </div>
          </div>
        </section>

        {returning ? <LastSet sets={sets} now={now} /> : <FirstRun />}
      </div>

      {returning && (
        <>
          <Totals sets={sets} prog={prog} now={now} />
          {prog && <LevelCard level={prog.level} unlocked={Object.keys(prog.unlocked).length} />}
        </>
      )}
    </main>
  );
}
