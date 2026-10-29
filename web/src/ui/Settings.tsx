import type { ReactNode } from "react";
import { BODY_SIZES, type Body, type ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";
import type { ModelVariant } from "../pose/landmarker";
import type { Settings as SettingsValue } from "../store/settings";
import { AccountPanel } from "./AccountPanel";

/** One settings area: its title and description beside the panel that changes it. */
function Row({ title, children, description }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="setting-row">
      <div className="setting-label">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="setting-panel">{children}</div>
    </section>
  );
}

/** Dev builds only: fill or clear local history, for trying the app without a camera. */
function SampleData() {
  const run = (action: "seedSampleSets" | "clearSampleSets") => async () => {
    const n = await (await import("../dev/seed"))[action]();
    alert(action === "seedSampleSets" ? `Added ${n} sample sets.` : `Removed ${n} sample sets.`);
  };
  return (
    <Row title="Sample data (dev only)" description="Generated sets stay on this device and never sync to your account.">
      <div className="row tight">
        <button onClick={run("seedSampleSets")}>Add sample sets</button>
        <button className="ghost danger" onClick={run("clearSampleSets")}>Remove sample sets</button>
      </div>
    </Row>
  );
}

const BUILD_QUESTIONS: { segment: keyof Body; question: string; hint: string }[] = [
  { segment: "femur", question: "Your thighs (femurs)", hint: "Compared with your torso. Long femurs need more forward lean." },
  { segment: "torso", question: "Your torso", hint: "Compared with your legs. A short torso needs more forward lean." },
];

export function Settings({ settings, onChange, configs, onFeedback }: {
  settings: SettingsValue; onChange: (patch: Partial<SettingsValue>) => void; configs: Record<string, ExerciseConfig>;
  /** Opens the feedback survey; absent when the app runs without Supabase. */
  onFeedback?: () => void;
}) {
  const buildFor = EXERCISE_KEYS.filter((k) => Object.keys(configs[k].proportions).length > 0).map((k) => configs[k].name);
  const { body } = settings;

  return (
    <main className="page wide settings-page">
      <div className="title-row"><h1>Settings</h1></div>

      <Row title="Training" description="How a set runs. Every change saves as you make it.">
        <label className="switch-row">
          <span><b>Spoken cues</b><span>"Go deeper", "hips up" and a chime on each clean rep.</span></span>
          <input type="checkbox" role="switch" checked={settings.voice} onChange={(e) => onChange({ voice: e.target.checked })} />
        </label>
        <label className="switch-row">
          <span><b>Record for replay</b><span>Kept in memory for the summary, never saved or uploaded.</span></span>
          <input type="checkbox" role="switch" checked={settings.replay} onChange={(e) => onChange({ replay: e.target.checked })} />
        </label>
        <label className="field">
          <b>Pose model</b>
          <select value={settings.model} onChange={(e) => onChange({ model: e.target.value as ModelVariant })}>
            <option value="lite">Lite (faster, for phones)</option>
            <option value="full">Full (more accurate)</option>
          </select>
        </label>
      </Row>

      {buildFor.length > 0 && (
        <Row title="Your build" description={<>Long femurs or a short torso naturally push your chest forward, so lean limits adjust to fit you. Used for: {buildFor.join(", ").toLowerCase()}.</>}>
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
        </Row>
      )}

      <Row title="Account" description="Optional. Backs up your history, syncs it across devices and unlocks the AI review.">
        <AccountPanel />
      </Row>

      {onFeedback && (
        <Row title="Feedback" description="Tell us what's working and what isn't. Five quick questions, all optional.">
          <button onClick={onFeedback}>Send feedback</button>
        </Row>
      )}

      <Row title="Support cleanReps" description="cleanReps is free. Donations help cover hosting and the AI coach.">
        <a className="button" href="https://ko-fi.com/nnguyen" target="_blank" rel="noopener">Donate on Ko-fi</a>
      </Row>

      {import.meta.env.DEV && <SampleData />}
    </main>
  );
}
