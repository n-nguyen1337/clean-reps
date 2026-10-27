import { useMemo } from "react";
import type { ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";
import type { Progression } from "../store/achievements";
import { weekStreak } from "../store/progress";
import type { SetRecord } from "../store/record";
import type { Settings } from "../store/settings";
import { LevelCard } from "./Achievements";
import { ICONS } from "./Shell";

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

function WelcomeBack({ sets, prog }: { sets: SetRecord[]; prog: Progression | null }) {
  const now = useMemo(() => new Date(), []);
  const last = sets[0].summary;
  const streak = weekStreak(sets, now);
  return (
    <section className="welcome">
      <h1>Welcome back</h1>
      {prog && <LevelCard level={prog.level} unlocked={Object.keys(prog.unlocked).length} />}
      <p className="last-set">
        Last set: <b>{sets[0].config.name}</b> {relativeDay(new Date(last.started), now)} · {last.reps} reps, {last.cleanReps} clean
        {streak > 1 && <><br /><span className="streak">{streak}-week streak. Keep it going.</span></>}
      </p>
    </section>
  );
}

function Hero() {
  return (
    <section className="hero">
      <h1>Every rep, counted and checked.</h1>
      <p className="lede">Prop up your phone and train. cleanReps counts your reps and calls out form issues as you go. Pose tracking runs on this device, and video never leaves it.</p>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.title}><i>{i + 1}</i><div><b>{s.title}</b><span>{s.text}</span></div></li>
        ))}
      </ol>
      <a className="text-link" href="#/about">How it works</a>
    </section>
  );
}

export function Home({ sets, prog, configs, exercise, onExercise, settings, onStart }: {
  sets: SetRecord[] | null; prog: Progression | null; configs: Record<string, ExerciseConfig>;
  exercise: string; onExercise: (key: string) => void; settings: Settings; onStart: () => void;
}) {
  const usesBuild = Object.keys(configs[exercise].proportions).length > 0;

  return (
    <main className="page has-start">
      <header className="app-header">
        <span className="wordmark">cleanReps</span>
        <a className="icon-btn" href="#/settings" aria-label="Settings">{ICONS.settings}</a>
      </header>

      {sets && (sets.length > 0 ? <WelcomeBack sets={sets} prog={prog} /> : <Hero />)}

      <h2>Exercise</h2>
      <div className="choices" role="radiogroup" aria-label="Exercise">
        {EXERCISE_KEYS.map((k) => (
          <button key={k} className={`choice ${k === exercise ? "selected" : ""}`} role="radio"
            aria-checked={k === exercise} onClick={() => onExercise(k)}>
            <b>{configs[k].name}</b>
            <span>{configs[k].cameraHint}</span>
          </button>
        ))}
      </div>

      <a className="settings-summary" href="#/settings">
        <span>{settingsLine(settings, usesBuild)}</span>
        <span className="text-link">Change</span>
      </a>

      <p className="disclaimer">Not medical advice. Cues are starting points; stop if anything hurts.</p>

      <div className="start-bar">
        <button className="primary big" onClick={onStart}>Start {configs[exercise].name.toLowerCase()}</button>
      </div>
    </main>
  );
}
