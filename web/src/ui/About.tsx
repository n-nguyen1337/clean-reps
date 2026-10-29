import standing from "../assets/about/squat-standing.jpg";
import lowering from "../assets/about/squat-lowering.jpg";
import bottom from "../assets/about/squat-bottom.jpg";
import rising from "../assets/about/squat-rising.jpg";
import wide from "../assets/about/squat-wide.jpg";
import type { ExerciseConfig } from "../engine/exercise";
import { EXERCISE_KEYS } from "../engine/exercises";
import { PosePhoto } from "./about/PoseFigure";
import { RepDemo } from "./about/RepDemo";
import { CROP_BOX, FH, FW, SQUAT } from "./about/squat";

const PHASES = [
  { key: "standing", label: "Standing", src: standing },
  { key: "lowering", label: "Lowering", src: lowering },
  { key: "bottom", label: "Bottom", src: bottom },
  { key: "rising", label: "Rising", src: rising },
] as const;

const STEPS = [
  { title: "Pick an exercise", text: "Squats and push-ups. Each one says where to put the camera." },
  { title: "Prop up your phone", text: "Your whole body in frame, then tap Start." },
  { title: "Train", text: "Joints are tracked, reps counted, and form slips called out loud. A chime means a clean rep." },
  { title: "Review the set", text: "Replay it with your skeleton drawn over the video, jump to any rep, and see depth, tempo and form per rep." },
  { title: "Watch it add up", text: "Every set is saved, so reps, form and range of motion trend over the weeks, with levels and achievements." },
];

const STAYS = [
  "Your camera video. Pose tracking runs in the browser.",
  "The replay recording, held in this page's memory and gone when you leave the summary. Turn off \"Record for replay\" to skip it.",
  "Your set history, unless you sign in.",
];

const LEAVES = [
  { when: "If you sign in with Google", what: "Your sets are backed up and synced across devices: the numbers, never video." },
  { when: "If you ask for an AI review", what: "That set's numbers go to Claude for a written review." },
  { when: "If you send the feedback survey", what: "Your answers, with the set's exercise, rep and fault counts, the pose model and your device type." },
  { when: "On every visit", what: "GoatCounter counts which page was opened. No cookies, no tracking across sites, never your sets." },
];

export function About({ configs }: { configs: Record<string, ExerciseConfig> }) {
  const hero = SQUAT.hero;
  return (
    <main className="page wide about-page">
      <section className="about-hero">
        <div className="about-hero-text">
          <h1>Reps counted from your camera</h1>
          <p className="about-lede">
            cleanReps counts your squats and push-ups and calls out form slips while you train.
            Pose tracking runs on this device, and video never leaves it.
          </p>
          <a className="button primary" href="#/">Start a set</a>
        </div>
        <figure className="about-hero-pic">
          <PosePhoto src={wide} viewBox={`0 0 ${FW} ${FH}`} p={hero.p} kneeAngle={hero.knee} scale={0.9} eager
            alt="A man at the bottom of a squat on a beach by a marina, with his tracked skeleton drawn over him" />
          <figcaption>What the tracker sees on every camera frame: 22 joints. At the bottom of this squat the knee is at {Math.round(hero.knee)}°.</figcaption>
        </figure>
      </section>

      <section className="about-section">
        <div className="about-head">
          <h2>How a rep is counted</h2>
          <p>A real squat, as cleanReps tracked it. Drag along the knee angle and watch when a rep counts.</p>
        </div>
        <RepDemo config={configs.squat} />
      </section>

      <section className="about-section">
        <div className="about-head">
          <h2>The cues you'll hear</h2>
          <p>Spoken the moment a rep slips, so you fix the next one. A rep that misses the depth line isn't counted.</p>
        </div>
        <div className="cue-columns panel">
          {EXERCISE_KEYS.map((k) => (
            <div key={k} className="cue-list">
              <h3>{configs[k].name}</h3>
              <ul>{configs[k].rules.map((r) => <li key={r.id}>"{r.cue}"</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <div className="about-head">
          <h2>Set up the camera</h2>
          <p>Side-on, a couple of metres back, with your whole body in frame from standing to the bottom of the rep.</p>
        </div>
        <ul className="phase-strip">
          {PHASES.map(({ key, label, src }) => {
            const still = SQUAT.phases[key];
            return (
              <li key={key}>
                <figure>
                  <PosePhoto src={src} viewBox={CROP_BOX} p={still.p} kneeAngle={still.knee} scale={1.3}
                    alt={`${label}, side view, knee at ${Math.round(still.knee)} degrees`} />
                  <figcaption><b>{label}</b> knee {Math.round(still.knee)}°</figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
        <div className="setup-columns">
          {EXERCISE_KEYS.map((k) => (
            <p key={k}><b>{configs[k].name}</b>{configs[k].cameraHint}</p>
          ))}
          <p><b>For a steady read</b>Good light, a plain background, fitted clothes and a camera that doesn't move. Use the Lite model if your phone struggles.</p>
        </div>
      </section>

      <section className="about-section">
        <h2>From first set to progress</h2>
        <ol className="about-steps">
          {STEPS.map((s) => <li key={s.title}><b>{s.title}</b><span>{s.text}</span></li>)}
        </ol>
      </section>

      <section className="about-section">
        <div className="about-head">
          <h2>Private by design</h2>
          <p className="about-statement">Your video never leaves this device. No account is needed, and history stays here unless you choose otherwise.</p>
        </div>
        <div className="ledger panel">
          <div>
            <h3>Stays on this device</h3>
            <ul>{STAYS.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          <div>
            <h3>What can leave, and when</h3>
            <ul>{LEAVES.map((l) => <li key={l.when}><b>{l.when}</b>{l.what}</li>)}</ul>
            <p className="meta">Sign in from <a href="#/settings">Settings</a>. Everything else works without it.</p>
          </div>
        </div>
      </section>

      <footer className="about-footer">
        <p className="about-name logo-word" aria-label="cleanReps">CLEAN<b>REPS</b></p>
        <div>
          <p>Not medical advice. Cues are starting points; stop if anything hurts.</p>
          <p>Squat footage: {SQUAT.source} (Pexels licence), tracked by cleanReps. Version {__APP_VERSION__}.</p>
        </div>
      </footer>
    </main>
  );
}
