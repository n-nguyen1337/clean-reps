import { BODY_SIZES, type Body, type ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";
import type { ModelVariant } from "../pose/landmarker";
import type { Settings as SettingsValue } from "../store/settings";
import { AccountPanel } from "./AccountPanel";

const BUILD_QUESTIONS: { segment: keyof Body; question: string; hint: string }[] = [
  { segment: "femur", question: "Your thighs (femurs)", hint: "Compared with your torso. Long femurs need more forward lean." },
  { segment: "torso", question: "Your torso", hint: "Compared with your legs. A short torso needs more forward lean." },
];

export function Settings({ settings, onChange, configs }: {
  settings: SettingsValue; onChange: (patch: Partial<SettingsValue>) => void; configs: Record<string, ExerciseConfig>;
}) {
  const buildFor = EXERCISE_KEYS.filter((k) => Object.keys(configs[k].proportions).length > 0).map((k) => configs[k].name);
  const { body } = settings;

  return (
    <main className="page">
      <h1>Settings</h1>

      {buildFor.length > 0 && (
        <>
          <h2>Your build</h2>
          <p className="lede">Long femurs or a short torso naturally push your chest forward, so lean limits adjust to fit you. Used for: {buildFor.join(", ").toLowerCase()}.</p>
          {BUILD_QUESTIONS.map(({ segment, question, hint }) => (
            <div key={segment} className="build">
              <b>{question}</b>
              <span>{hint}</span>
              <div className="segmented">
                {BODY_SIZES.map((size) => (
                  <button key={size} className={size === body[segment] ? "selected" : ""}
                    aria-pressed={size === body[segment]} onClick={() => onChange({ body: { ...body, [segment]: size } })}>
                    {size === "average" ? "Average / not sure" : size[0].toUpperCase() + size.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Training</h2>
      <label className="toggle">
        <input type="checkbox" checked={settings.voice} onChange={(e) => onChange({ voice: e.target.checked })} />
        Spoken cues
      </label>
      <label className="toggle">
        <input type="checkbox" checked={settings.replay} onChange={(e) => onChange({ replay: e.target.checked })} />
        Record for replay (kept in memory for the summary, never saved)
      </label>
      <label className="toggle">
        Model
        <select value={settings.model} onChange={(e) => onChange({ model: e.target.value as ModelVariant })}>
          <option value="lite">Lite (faster, for phones)</option>
          <option value="full">Full (more accurate)</option>
        </select>
      </label>

      <h2>Account</h2>
      <AccountPanel />
    </main>
  );
}
