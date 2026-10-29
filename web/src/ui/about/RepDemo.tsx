import { useEffect, useMemo, useRef, useState } from "react";
import type { ExerciseConfig } from "../../engine/exercise";
import { Skeleton } from "./PoseFigure";
import { CROP_BOX, SQUAT } from "./squat";

const FRAMES = SQUAT.frames;
const LO = 40, HI = 180; // knee angle range of the trace, degrees
const TICKS = [60, 90, 120, 150, 180];
const y = (deg: number) => (1 - (deg - LO) / (HI - LO)) * 100;

/** The knee angle over the clip, broken where tracking dropped out. */
const LINE = (() => {
  let d = "", pen = false;
  FRAMES.forEach((f, k) => {
    if (f.knee === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${((k / (FRAMES.length - 1)) * 1000).toFixed(1)},${y(f.knee).toFixed(2)}`;
    pen = true;
  });
  return d;
})();

/** Reps completed by each frame: down past the counting line, then back up to standing. */
function repsByFrame(bottom: number, top: number): number[] {
  let down = false, reps = 0;
  return FRAMES.map((f) => {
    if (f.knee !== null) {
      if (f.knee < bottom) down = true;
      else if (down && f.knee > top) { down = false; reps++; }
    }
    return reps;
  });
}

/** One real squat clip as a pose the visitor can scrub, with the knee angle against the line that counts a rep. */
export function RepDemo({ config }: { config: ExerciseConfig }) {
  const bottom = config.bottomThreshold;
  const top = config.topThreshold - (config.topMargin ?? 0);
  const reps = useMemo(() => repsByFrame(bottom, top), [bottom, top]);
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const firstBottom = useMemo(() => FRAMES.reduce((best, f, i) =>
    f.t < 2.2 && f.knee !== null && f.knee < (FRAMES[best].knee ?? Infinity) ? i : best, 0), []);
  const [i, setI] = useState(reduced ? firstBottom : 0);
  const [playing, setPlaying] = useState(!reduced);
  const last = useRef<number | null>(null);

  // Plays at real speed and loops, until the visitor takes the slider.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, pos = i;
    const tick = (now: number) => {
      if (last.current !== null) pos = (pos + ((now - last.current) / 1000) * 15) % FRAMES.length;
      last.current = now;
      setI(Math.floor(pos));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing]); // only on play/pause: it resumes from wherever the slider was left

  const f = FRAMES[i];
  const deep = f.knee !== null && f.knee < bottom;
  const x = (i / (FRAMES.length - 1)) * 100;

  return (
    <div className="rep-demo">
      <div className="demo-stage">
        <svg viewBox={CROP_BOX} role="img" aria-label={`Tracked skeleton at ${f.t.toFixed(1)} seconds`}>
          <Skeleton p={f.p} scale={1.4} />
        </svg>
      </div>

      <div className="demo-side">
        <dl className="demo-readout">
          <div className={deep ? "deep" : undefined}>
            <dt>Knee angle</dt>
            <dd className="num">{f.knee === null ? <span className="dash">–</span> : <>{Math.round(f.knee)}°</>}</dd>
          </div>
          <div>
            <dt>Reps past the line</dt>
            <dd className="num">{reps[i]}</dd>
          </div>
        </dl>
        <p className="demo-status" aria-live="polite">
          {deep ? `Below ${bottom}°: deep enough. The rep counts when you stand back up.`
            : `Above ${bottom}°. Bend past the line, then stand up past ${top}°, to count a rep.`}
        </p>

        <div className="demo-trace">
          <div className="demo-plot">
            {TICKS.map((t) => (
              <span key={t} className={`tick${t === bottom ? " line" : ""}`} style={{ top: `${y(t)}%` }}>
                {t === bottom ? `${t}° counts` : `${t}°`}
              </span>
            ))}
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              {TICKS.map((t) => <line key={t} className={t === bottom ? "count-line" : "grid"} x1="0" x2="1000" y1={y(t)} y2={y(t)} />)}
              <path className="knee-line" d={LINE} />
            </svg>
            <i className="playhead" style={{ left: `${x}%` }} />
            <input type="range" min={0} max={FRAMES.length - 1} value={i} aria-label="Position in the squat clip"
              aria-valuetext={`${f.t.toFixed(1)} s, knee ${f.knee === null ? "not tracked" : `${Math.round(f.knee)} degrees`}`}
              onPointerDown={() => setPlaying(false)} onKeyDown={() => setPlaying(false)}
              onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} />
          </div>
          <div className="demo-foot">
            <span className="num">0 s</span>
            <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <span className="num">{FRAMES[FRAMES.length - 1].t.toFixed(1)} s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
