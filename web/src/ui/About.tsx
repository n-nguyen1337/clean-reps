import type { ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";

export function About({ configs }: { configs: Record<string, ExerciseConfig> }) {
  return (
    <main className="page about-page">
      <h1>About cleanReps</h1>
      <p className="lede">Rep counting and form cues from your camera. Everything runs on this device; no video leaves it.</p>

      <h2>How it works</h2>
      <ol className="steps">
        <li><i>1</i><div><b>Pick an exercise.</b><span>Squats and push-ups are supported. Each card says where to put the camera.</span></div></li>
        <li><i>2</i><div><b>Set up the camera.</b><span>Prop your phone or laptop so your whole body is in frame, then tap Start.</span></div></li>
        <li><i>3</i><div><b>Train.</b><span>The app tracks your joints, counts reps, and calls out form issues like a shallow squat or sagging hips. A chime means a clean rep.</span></div></li>
        <li><i>4</i><div><b>Review.</b><span>After the set, replay it with your tracked skeleton drawn over the video, jump to any rep, and see per-rep depth, tempo and form charts, plus tips on what to work on next.</span></div></li>
        <li><i>5</i><div><b>Track progress.</b><span>Every set is saved, so you can see your reps, form and range of motion change over the weeks, level up and earn achievements.</span></div></li>
      </ol>

      <h2>Camera setup</h2>
      <ul className="cards">
        {EXERCISE_KEYS.map((k) => (
          <li key={k}><b>{configs[k].name}</b><span>{configs[k].cameraHint}</span></li>
        ))}
      </ul>

      <h2>Private by design</h2>
      <p>Pose tracking runs in your browser, and video never leaves your device. For the replay, the set is recorded into this page's memory only: it's never saved or uploaded, and it's gone when you leave the summary. Turn off "Record for replay" in Settings to skip recording altogether.</p>
      <p>No account needed: history is saved on this device.</p>

      <h2>Optional sign-in</h2>
      <p>Sign in with Google in <a href="#/settings">Settings</a> to back up and sync your history and to get a written AI review of each set. Only the set's numbers leave your device, never video.</p>

      <h2>Tips</h2>
      <ul className="tips">
        <li>Use good lighting and a plain background.</li>
        <li>Wear fitted clothes so your joints are easy to see.</li>
        <li>Keep the camera still.</li>
        <li>Use the Lite model if your phone struggles.</li>
      </ul>

      <footer className="about-footer">
        <p className="disclaimer">Not medical advice. Cues are starting points; stop if anything hurts.</p>
        <p className="disclaimer">cleanReps v{__APP_VERSION__}</p>
      </footer>
    </main>
  );
}
