import { useEffect, useMemo, useState } from "react";
import { useAccount } from "./cloud/account";
import { AVERAGE_BODY, BODY_SIZES, type Body, type BodySize } from "./engine/exercise";
import { EXERCISE_KEYS, createExercise } from "./engine/exercises";
import { Speaker } from "./engine/feedback";
import type { SessionRecord } from "./engine/session";
import type { Playback } from "./playback/playback";
import { defaultModel, type ModelVariant } from "./pose/landmarker";
import { ACHIEVEMENTS, progression, setProgress } from "./store/achievements";
import { deleteSet, saveSet, saveUnlocks, useSets, useUnlocks } from "./store/db";
import { setXp } from "./store/level";
import { previousSet } from "./store/progress";
import { toSessionRecord, toSetRecord, type SetRecord } from "./store/record";
import { AccountPanel } from "./ui/AccountPanel";
import { AchievementBoard, EarnedInSet, SetProgressPanel } from "./ui/Achievements";
import { LiveSession } from "./ui/LiveSession";
import { Progress } from "./ui/Progress";
import { Summary } from "./ui/Summary";

const BODY_KEY = "cleanreps.body";
const REPLAY_KEY = "cleanreps.replay";

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

function loadReplay(): boolean {
  try {
    return localStorage.getItem(REPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveReplay(on: boolean) {
  try {
    localStorage.setItem(REPLAY_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lasts this visit only */
  }
}

type Screen =
  | { kind: "pick" }
  | { kind: "live"; exercise: string }
  | { kind: "summary"; record: SessionRecord; set: SetRecord; playback: Playback | null }
  | { kind: "progress" }
  | { kind: "achievements" }
  | { kind: "past"; set: SetRecord };

export function App() {
  const configs = useMemo(() => Object.fromEntries(EXERCISE_KEYS.map((k) => [k, createExercise(k).config])), []);
  const speaker = useMemo(() => new Speaker(), []);
  const [screen, setScreen] = useState<Screen>({ kind: "pick" });
  const [exercise, setExercise] = useState(EXERCISE_KEYS[0]);
  const [model, setModel] = useState<ModelVariant>(defaultModel);
  const [voice, setVoice] = useState(true);
  const [body, setBody] = useState<Body>(loadBody);
  const [replay, setReplay] = useState(loadReplay);
  const sets = useSets();
  const unlocks = useUnlocks();
  const account = useAccount();
  const prog = useMemo(() => sets && unlocks && progression(sets, unlocks), [sets, unlocks]);
  // Keep every unlock on the device, so deleting the set that earned it doesn't take it away.
  useEffect(() => {
    if (prog) saveUnlocks(prog.unlocked).catch(() => {});
  }, [prog]);
  const summarySet = screen.kind === "summary" && screen.record.reps.length > 0 ? screen.set : null;
  const setProg = useMemo(() => summarySet && sets && unlocks && setProgress(sets, summarySet, unlocks),
    [summarySet, sets, unlocks]);

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
    return <LiveSession exercise={screen.exercise} body={body} model={model} speaker={speaker} recordVideo={replay}
      onDone={(record, playback) => {
        const set = toSetRecord(record);
        if (record.reps.length > 0) saveSet(set).then(account.requestSync).catch(() => {});
        setScreen({ kind: "summary", record, set, playback });
      }} />;
  }

  if (screen.kind === "summary") {
    return (
      <Summary record={screen.record} previous={sets && previousSet(sets, screen.set)} playback={screen.playback}
        progress={setProg && <SetProgressPanel progress={setProg} />}>
        <button className="primary" onClick={start}>Go again</button>
        <button className="ghost" onClick={() => setScreen({ kind: "pick" })}>Change exercise</button>
      </Summary>
    );
  }

  if (screen.kind === "progress") {
    return <Progress sets={sets} prog={prog} onOpen={(set) => setScreen({ kind: "past", set })}
      onAchievements={() => setScreen({ kind: "achievements" })} onBack={() => setScreen({ kind: "pick" })} />;
  }

  if (screen.kind === "achievements" && prog && sets) {
    return <AchievementBoard prog={prog} sets={sets} onOpen={(set) => setScreen({ kind: "past", set })}
      onBack={() => setScreen({ kind: "progress" })} />;
  }

  if (screen.kind === "past") {
    const { set } = screen;
    const earned = prog ? ACHIEVEMENTS.filter((d) => prog.unlocked[d.id]?.setId === set.id) : [];
    return (
      <Summary record={toSessionRecord(set)} previous={sets && previousSet(sets, set)}
        progress={<EarnedInSet xp={setXp(set.summary)} earned={earned} />}>
        <button className="primary" onClick={() => setScreen({ kind: "progress" })}>Back to progress</button>
        <button className="ghost danger" onClick={async () => {
          if (!confirm("Delete this set from your history?")) return;
          await deleteSet(set.id);
          account.requestSync();
          setScreen({ kind: "progress" });
        }}>Delete set</button>
      </Summary>
    );
  }

  return (
    <main className="page">
      <div className="title-row">
        <h1>cleanReps</h1>
        <button className="ghost" onClick={() => setScreen({ kind: "progress" })}>
          Progress{sets && sets.length > 0 ? ` (${sets.length})` : ""}
        </button>
      </div>
      <p className="lede">Rep counting and form cues from your camera. Everything runs on this device; no video leaves it.</p>

      <details className="about">
        <summary>About cleanReps</summary>
        <ol>
          <li><b>Pick an exercise.</b> Squats and push-ups are supported. Each card says where to put the camera.</li>
          <li><b>Set up the camera.</b> Prop your phone or laptop so your whole body is in frame, then tap Start.</li>
          <li><b>Train.</b> The app tracks your joints, counts reps, and calls out form issues like a shallow squat or sagging hips. A chime means a clean rep.</li>
          <li><b>Review.</b> After the set, replay it with your tracked skeleton drawn over the video, jump to any rep, and see per-rep depth, tempo and form charts, plus tips on what to work on next.</li>
          <li><b>Track progress.</b> Every set is saved, so you can see your reps, form and range of motion change over the weeks.</li>
        </ol>
        <p><b>Private by design.</b> Pose tracking runs in your browser, and video never leaves your device. For the replay, the set is recorded into this page's memory only: it's never saved or uploaded, and it's gone when you leave the summary. Turn off "Record for replay" to skip recording altogether. No account needed: history is saved on this device.</p>
        <p><b>Optional sign-in.</b> Sign in with Google to back up and sync your history and to get a written AI review of each set. Only the set's numbers leave your device, never video.</p>
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
        <input type="checkbox" checked={replay} onChange={(e) => { setReplay(e.target.checked); saveReplay(e.target.checked); }} />
        Record for replay (kept in memory for the summary, never saved)
      </label>
      <label className="toggle">
        Model
        <select value={model} onChange={(e) => setModel(e.target.value as ModelVariant)}>
          <option value="lite">Lite (faster, for phones)</option>
          <option value="full">Full (more accurate)</option>
        </select>
      </label>

      <h2>Account</h2>
      <AccountPanel />

      <button className="primary big" onClick={start}>Start</button>
      <p className="disclaimer">Not medical advice. Cues are starting points; stop if anything hurts.</p>
    </main>
  );
}
