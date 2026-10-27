import { useMemo, useState } from "react";
import { EXERCISE_KEYS, createExercise } from "./engine/exercises";
import { Speaker } from "./engine/feedback";
import type { SessionSummary } from "./engine/session";
import { defaultModel, type ModelVariant } from "./pose/landmarker";
import { LiveSession } from "./ui/LiveSession";

type Screen = { kind: "pick" } | { kind: "live"; exercise: string } | { kind: "summary"; summary: SessionSummary };

export function App() {
  const configs = useMemo(() => Object.fromEntries(EXERCISE_KEYS.map((k) => [k, createExercise(k).config])), []);
  const speaker = useMemo(() => new Speaker(), []);
  const [screen, setScreen] = useState<Screen>({ kind: "pick" });
  const [exercise, setExercise] = useState(EXERCISE_KEYS[0]);
  const [model, setModel] = useState<ModelVariant>(defaultModel);
  const [voice, setVoice] = useState(true);

  const start = () => {
    speaker.enabled = voice;
    speaker.unlock(); // must happen inside the tap for iOS
    setScreen({ kind: "live", exercise });
  };

  if (screen.kind === "live") {
    return <LiveSession exercise={screen.exercise} model={model} speaker={speaker}
      onDone={(summary) => setScreen({ kind: "summary", summary })} />;
  }

  if (screen.kind === "summary") {
    const s = screen.summary;
    const cfg = configs[s.exercise];
    const label = (id: string) => id === "partial" ? "Partial reps" : cfg.rules.find((r) => r.id === id)?.cue ?? id;
    const faults = Object.entries(s.faults).sort((a, b) => b[1] - a[1]);
    return (
      <main className="page">
        <h1>{cfg.name}</h1>
        <div className="stats">
          <div><b>{s.reps}</b><span>reps</span></div>
          <div><b>{s.cleanReps}</b><span>clean</span></div>
          <div><b>{s.partialReps}</b><span>partial</span></div>
        </div>
        {s.avgDownS !== null && <p>Tempo: {s.avgDownS}s down / {s.avgUpS}s up</p>}
        {faults.length > 0 && (
          <>
            <h2>What to work on</h2>
            <ul className="faults">
              {faults.map(([id, n]) => <li key={id}><span>{label(id)}</span><b>{n}×</b></li>)}
            </ul>
          </>
        )}
        <div className="row">
          <button className="primary" onClick={start}>Go again</button>
          <button className="ghost" onClick={() => setScreen({ kind: "pick" })}>Change exercise</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>cleanReps</h1>
      <p className="lede">Rep counting and form cues from your camera. Everything runs on this device; no video leaves it.</p>

      <h2>Exercise</h2>
      <div className="choices">
        {EXERCISE_KEYS.map((k) => (
          <button key={k} className={`choice ${k === exercise ? "selected" : ""}`} onClick={() => setExercise(k)}>
            <b>{configs[k].name}</b>
            <span>{configs[k].cameraHint}</span>
          </button>
        ))}
      </div>

      <h2>Settings</h2>
      <label className="toggle"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Spoken cues</label>
      <label className="toggle">
        Model
        <select value={model} onChange={(e) => setModel(e.target.value as ModelVariant)}>
          <option value="lite">Lite (faster, for phones)</option>
          <option value="full">Full (more accurate)</option>
        </select>
      </label>

      <button className="primary big" onClick={start}>Start</button>
      <p className="disclaimer">Not medical advice. Cues are starting points; stop if anything hurts.</p>
    </main>
  );
}
