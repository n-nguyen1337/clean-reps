import { useMemo, useState } from "react";
import { AVERAGE_BODY, BODY_SIZES, type Body, type BodySize } from "./engine/exercise";
import { EXERCISE_KEYS, createExercise } from "./engine/exercises";
import { Speaker } from "./engine/feedback";
import type { SessionRecord } from "./engine/session";
import { defaultModel, type ModelVariant } from "./pose/landmarker";
import { LiveSession } from "./ui/LiveSession";
import { ApiKeyField, Summary } from "./ui/Summary";

const BODY_KEY = "cleanreps.body";

const BUILD_QUESTIONS: { segment: keyof Body; question: string; hint: string }[] = [
  { segment: "femur", question: "Your thighs (femurs)", hint: "Compared with your torso. Long femurs need more forward lean." },
  { segment: "torso", question: "Your torso", hint: "Compared with your legs. A short torso needs more forward lean." },
];

function loadBody(): Body {
  try {
    const saved = JSON.parse(localStorage.getItem(BODY_KEY) ?? "null");
    if (BODY_SIZES.includes(saved?.femur) && BODY_SIZES.includes(saved?.torso)) return saved;
  } catch {
    /* storage unavailable or corrupt: fall back to average */
  }
  return AVERAGE_BODY;
}

function saveBody(body: Body) {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(body));
  } catch {
    /* storage unavailable: the choice lasts this visit only */
  }
}

type Screen = { kind: "pick" } | { kind: "live"; exercise: string } | { kind: "summary"; record: SessionRecord };

export function App() {
  const configs = useMemo(() => Object.fromEntries(EXERCISE_KEYS.map((k) => [k, createExercise(k).config])), []);
  const speaker = useMemo(() => new Speaker(), []);
  const [screen, setScreen] = useState<Screen>({ kind: "pick" });
  const [exercise, setExercise] = useState(EXERCISE_KEYS[0]);
  const [model, setModel] = useState<ModelVariant>(defaultModel);
  const [voice, setVoice] = useState(true);
  const [body, setBody] = useState<Body>(loadBody);

  const setBodySize = (segment: keyof Body, size: BodySize) => {
    const next = { ...body, [segment]: size };
    setBody(next);
    saveBody(next);
  };

  const start = () => {
    speaker.enabled = voice;
    speaker.unlock(); // must happen inside the tap for iOS
    setScreen({ kind: "live", exercise });
  };

  if (screen.kind === "live") {
    return <LiveSession exercise={screen.exercise} body={body} model={model} speaker={speaker}
      onDone={(record) => setScreen({ kind: "summary", record })} />;
  }

  if (screen.kind === "summary") {
    return <Summary record={screen.record} onAgain={start} onPick={() => setScreen({ kind: "pick" })} />;
  }

  return (
    <main className="page">
      <h1>cleanReps</h1>
      <p className="lede">Rep counting and form cues from your camera. Everything runs on this device; no video leaves it.</p>

      <details className="about">
        <summary>About cleanReps</summary>
        <ol>
          <li><b>Pick an exercise.</b> Squats, push-ups and curls are supported. Each card says where to put the camera.</li>
          <li><b>Set up the camera.</b> Prop your phone or laptop so your whole body is in frame, then tap Start.</li>
          <li><b>Train.</b> The app tracks your joints, counts reps, and calls out form issues like a shallow squat or sagging hips. A chime means a clean rep.</li>
          <li><b>Review.</b> After the set, see per-rep depth, tempo and form charts, plus tips on what to work on next.</li>
        </ol>
        <p><b>Private by design.</b> Pose tracking runs in your browser. No video is recorded or uploaded, and there are no accounts.</p>
        <p><b>Optional AI coaching.</b> Add your own Anthropic API key in Settings to get a written review of each set. Only the set's numbers are sent, never video.</p>
        <p><b>Tips.</b> Use good lighting and a plain background, wear fitted clothes, and keep the camera still. Use the Lite model if your phone struggles.</p>
      </details>

      <h2>Exercise</h2>
      <div className="choices">
        {EXERCISE_KEYS.map((k) => (
          <button key={k} className={`choice ${k === exercise ? "selected" : ""}`} onClick={() => setExercise(k)}>
            <b>{configs[k].name}</b>
            <span>{configs[k].cameraHint}</span>
          </button>
        ))}
      </div>

      {Object.keys(configs[exercise].proportions).length > 0 && (
        <>
          <h2>Your build</h2>
          <p className="lede">Long femurs or a short torso naturally push your chest forward, so lean limits adjust to fit you.</p>
          {BUILD_QUESTIONS.map(({ segment, question, hint }) => (
            <div key={segment} className="build">
              <b>{question}</b>
              <span>{hint}</span>
              <div className="segmented">
                {BODY_SIZES.map((size) => (
                  <button key={size} className={size === body[segment] ? "selected" : ""}
                    onClick={() => setBodySize(segment, size)}>
                    {size === "average" ? "Average / not sure" : size[0].toUpperCase() + size.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Settings</h2>
      <label className="toggle"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Spoken cues</label>
      <label className="toggle">
        Model
        <select value={model} onChange={(e) => setModel(e.target.value as ModelVariant)}>
          <option value="lite">Lite (faster, for phones)</option>
          <option value="full">Full (more accurate)</option>
        </select>
      </label>
      <ApiKeyField />

      <button className="primary big" onClick={start}>Start</button>
      <p className="disclaimer">Not medical advice. Cues are starting points; stop if anything hurts.</p>
    </main>
  );
}
