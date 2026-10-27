// Set replay on the summary screen: the recorded video with the skeleton the
// engine saw drawn over it, a timeline of reps, and rep-by-rep controls.

import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { metricInfo, type RepRow } from "../engine/analysis";
import type { TracePoint } from "../engine/session";
import { alignOffset, RECORD_CAP_S, repAt, traceValueAt, type Playback } from "../playback/playback";
import { drawPose } from "./overlay";

export interface PlayerHandle {
  /** Play one rep from just before it starts, stopping (or looping) just after it ends. */
  playRep(row: RepRow): void;
  /** Pause at set time `t`. */
  seek(t: number): void;
}

const PAD_S = 0.3; // lead-in and lead-out around a rep
const FRAME_S = 1 / 30;
const SPEEDS = [0.25, 0.5, 1];

const tone = (row: RepRow) => (!row.rep.counted ? "bad" : row.rep.faults.length ? "warn" : "good");
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Timeline({ rows, t, end, recEnd, active, onScrub }: {
  rows: RepRow[]; t: number; end: number; recEnd: number; active: RepRow | null; onScrub: (t: number) => void;
}) {
  const pct = (s: number) => `${(Math.min(Math.max(s, 0), end) / end) * 100}%`;
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onScrub(((e.clientX - box.left) / box.width) * end);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) { e.preventDefault(); onScrub(t + step); }
  };

  return (
    <div className="timeline" role="slider" tabIndex={0} aria-label="Replay position"
      aria-valuemin={0} aria-valuemax={Math.round(end)} aria-valuenow={Math.round(t)} aria-valuetext={clock(t)}
      onKeyDown={onKey}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e); }}>
      {recEnd < end && <div className="unrecorded" style={{ left: pct(recEnd) }} />}
      {rows.map((r) => (
        <div key={r.label} className={`seg ${tone(r)} ${r === active ? "active" : ""}`}
          style={{ left: pct(r.rep.startS), width: pct(r.rep.endS - r.rep.startS) }}>
          <i style={{ left: `${((r.rep.bottomS - r.rep.startS) / Math.max(r.rep.endS - r.rep.startS, 1e-6)) * 100}%` }} />
        </div>
      ))}
      <div className="playhead" style={{ left: pct(t) }} />
    </div>
  );
}

export function Player({ playback, rows, trace, metric, faultLabel, onTime, ref }: {
  playback: Playback;
  rows: RepRow[];
  trace: TracePoint[];
  metric: string;
  faultLabel: (id: string) => string;
  /** Called as the replay moves, a few times a second. */
  onTime?: (t: number) => void;
  ref?: Ref<PlayerHandle>;
}) {
  const { endS: recEnd, poses, width, height } = playback;
  // Set time at video time 0: an estimate until the video's duration is known.
  const [offsetS, setOffsetS] = useState(playback.offsetS);
  const end = Math.max(recEnd, ...rows.map((r) => r.rep.endS));
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [t, setT] = useState(playback.offsetS);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [active, setActive] = useState<RepRow | null>(null);
  // Read by the frame loop, which outlives renders.
  const activeRef = useRef<RepRow | null>(null);
  const loopRef = useRef(false);
  const onTimeRef = useRef(onTime);
  useEffect(() => { onTimeRef.current = onTime; }, [onTime]);

  const select = (row: RepRow | null) => { activeRef.current = row; setActive(row); };
  const toggleLoop = (on: boolean) => { loopRef.current = on; setLoop(on); };

  useEffect(() => {
    const u = URL.createObjectURL(playback.video);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [playback.video]);

  useEffect(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!url || !video || !canvas) return;
    const ctx = canvas.getContext("2d")!;
    let handle = 0, fixingDuration = false, lastMedia = -1, reported = -1;

    const draw = (mediaTime: number) => {
      if (fixingDuration) return;
      lastMedia = mediaTime;
      const now = mediaTime + offsetS;
      drawPose(ctx, poses.at(now));
      setT(now);
      const rep = activeRef.current;
      if (rep && !video.paused && now >= rep.rep.endS + PAD_S) {
        if (loopRef.current) video.currentTime = Math.max(rep.rep.startS - PAD_S - offsetS, 0);
        else video.pause();
      }
      if (Math.abs(now - reported) >= 0.2) {
        reported = now;
        onTimeRef.current?.(now);
      }
    };
    const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => { draw(meta.mediaTime); schedule(); };
    const onTick = () => { if (video.currentTime !== lastMedia) draw(video.currentTime); schedule(); };
    const schedule = () => {
      handle = "requestVideoFrameCallback" in video ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onTick);
    };
    const onSeeked = () => draw(video.currentTime);
    const onMeta = () => {
      const ready = () => {
        setOffsetS(alignOffset(playback, video.duration));
        video.currentTime = 0.001; // makes iOS show the first frame
      };
      if (Number.isFinite(video.duration)) return ready();
      // MediaRecorder's WebM has no duration until the browser has scanned to the end.
      fixingDuration = true;
      video.addEventListener("timeupdate", () => { fixingDuration = false; ready(); }, { once: true });
      video.currentTime = 1e101;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    schedule();
    return () => {
      if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(handle);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [url, offsetS, poses, playback]);

  const seekTo = (target: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.min(Math.max(target, offsetS), recEnd) - offsetS;
  };
  const play = () => { videoRef.current?.play().catch(() => {}); };

  const playRep = (row: RepRow) => {
    if (row.rep.startS >= recEnd) return;
    select(row);
    seekTo(row.rep.startS - PAD_S);
    play();
  };

  useImperativeHandle(ref, () => ({
    playRep,
    seek: (target) => {
      select(null);
      videoRef.current?.pause();
      seekTo(target);
    },
  }));

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) return video.pause();
    if (active && t >= active.rep.endS) seekTo(active.rep.startS - PAD_S);
    else if (t >= recEnd - 0.05) seekTo(offsetS);
    play();
  };
  const step = (dir: number) => {
    videoRef.current?.pause();
    seekTo(t + dir * FRAME_S);
  };
  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
  };

  const recorded = rows.filter((r) => r.rep.startS < recEnd);
  const from = active?.rep.startS ?? t;
  const prev = recorded.findLast((r) => r.rep.startS < from - 0.05);
  const next = recorded.find((r) => r.rep.startS > from + 0.05);
  const current = repAt(rows, t);
  const value = traceValueAt(trace, metric, t);
  const info = metricInfo(metric);
  const verdict = (row: RepRow) =>
    !row.rep.counted ? "Partial rep"
      : row.rep.faults.length ? `Rep ${row.label}: ${row.rep.faults.map(faultLabel).join(", ")}` : `Rep ${row.label}: clean`;

  return (
    <div className="replay">
      <div className="replay-view" style={{ aspectRatio: `${width} / ${height}` }}>
        <div className="stage">
          {url && <video ref={videoRef} src={url} playsInline muted preload="auto" />}
          <canvas ref={canvasRef} width={width} height={height} />
        </div>
        <div className="replay-hud">
          {current ? <span className={`pill ${tone(current)}`}>{verdict(current)}</span> : <span />}
          {value !== null && (
            <span className="pill">{info.label} {info.unit === "°" ? `${value.toFixed(0)}°` : value.toFixed(2)}</span>
          )}
        </div>
      </div>

      <Timeline rows={rows} t={t} end={end} recEnd={recEnd} active={active}
        onScrub={(target) => { select(null); seekTo(target); }} />

      <div className="replay-controls">
        <button className="ghost" disabled={!prev} onClick={() => prev && playRep(prev)} aria-label="Previous rep" title="Previous rep">⏮</button>
        <button className="ghost" onClick={() => step(-1)} aria-label="Back one frame" title="Back one frame">‹</button>
        <button className="primary" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <button className="ghost" onClick={() => step(1)} aria-label="Forward one frame" title="Forward one frame">›</button>
        <button className="ghost" disabled={!next} onClick={() => next && playRep(next)} aria-label="Next rep" title="Next rep">⏭</button>
        <span className="replay-time">{clock(t)} / {clock(end)}</span>
      </div>

      <div className="replay-options">
        <div className="segmented speeds" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? "selected" : ""} onClick={() => changeSpeed(s)}>{s}×</button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={loop} onChange={(e) => toggleLoop(e.target.checked)} />
          Loop {active ? `rep ${active.label}` : "the rep you pick"}
        </label>
      </div>

      {rows.length > 0 && (
        <div className="rep-chips" role="group" aria-label="Play a rep">
          {rows.map((r) => (
            <button key={r.label} className={`chip ${tone(r)} ${r === active ? "active" : ""}`}
              disabled={r.rep.startS >= recEnd} onClick={() => playRep(r)}>{r.label}</button>
          ))}
        </div>
      )}
      {recorded.length < rows.length && (
        <p className="hint small">Replay keeps the first {RECORD_CAP_S / 60} minutes, so reps after {clock(recEnd)} weren't recorded.</p>
      )}
    </div>
  );
}
