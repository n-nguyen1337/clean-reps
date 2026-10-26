"""Browser viewer: render clips with the overlay, then play/scrub them in a web page.

``serve`` runs a local server that analyzes clips on demand; ``export_site`` pre-renders
clips into a static folder (e.g. for GitHub Pages) that uses the same page.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2

from .capture import VideoSource
from .exercises import EXERCISES
from .feedback import CueManager
from .pipeline import Pipeline
from .session import Session
from .ui import draw_hud, draw_pose

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


class Render:
    """A clip run through the pipeline: JPEG frames plus rep/summary data."""

    def __init__(self, path: Path, exercise: str, model: str, max_width: int | None = 1280,
                 quality: int = 85):
        self.frames: list[bytes] = []
        session = Session(exercise)
        cues, last_rep = CueManager(), None
        with VideoSource(str(path), mirror=False) as source, Pipeline(exercise, model) as pipe:
            self.fps = source.fps
            while (item := source.read()) is not None:
                frame, t = item
                # Downscale first so the HUD is drawn at a readable size for the output.
                if max_width and frame.shape[1] > max_width:
                    scale = max_width / frame.shape[1]
                    frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                pose, update = pipe.process(frame, t)
                if update.completed is not None:
                    session.add(update.completed)
                    last_rep = update.completed
                cues.push(update.cues, t)
                if pose is not None:
                    draw_pose(frame, pose)
                draw_hud(frame, pipe.exercise.config, update, cues.current(t), last_rep, self.fps)
                self.frames.append(cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes())
            hint = pipe.exercise.config.camera_hint
        self.info = {
            "frames": len(self.frames),
            "fps": self.fps,
            "camera_hint": hint,
            "summary": session.summary(),
            "reps": [{"index": r.index, "counted": r.counted, "clean": r.clean, "faults": r.faults,
                      "start_s": r.start_s, "bottom_s": r.bottom_s, "end_s": r.end_s}
                     for r in session.reps],
        }


class Viewer:
    def __init__(self, video_dir: Path, model: str):
        self.video_dir = video_dir
        self.model = model
        self.current: Render | None = None
        self._cache: dict[tuple[str, str], Render] = {}
        self._lock = threading.Lock()

    def videos(self) -> list[str]:
        return sorted(p.name for p in self.video_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS)

    def render(self, name: str, exercise: str) -> Render:
        if name not in self.videos():
            raise ValueError(f"unknown video {name!r}")
        if exercise not in EXERCISES:
            raise ValueError(f"unknown exercise {exercise!r}")
        with self._lock:
            key = (name, exercise)
            if key not in self._cache:
                self._cache[key] = Render(self.video_dir / name, exercise, self.model)
            self.current = self._cache[key]
            return self.current


def _handler(viewer: Viewer) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def _send(self, body: bytes, ctype: str, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data, status: int = 200) -> None:
            self._send(json.dumps(data).encode(), "application/json", status)

        def do_GET(self) -> None:
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            if url.path == "/":
                self._send(page("live").encode(), "text/html; charset=utf-8")
            elif url.path == "/api/videos":
                self._json({"videos": viewer.videos(), "exercises": sorted(EXERCISES)})
            elif url.path == "/api/render":
                try:
                    self._json(viewer.render(q.get("video", ""), q.get("exercise", "squat")).info)
                except ValueError as e:
                    self._json({"error": str(e)}, 400)
            elif url.path.startswith("/frame/") and viewer.current is not None:
                try:
                    self._send(viewer.current.frames[int(url.path[7:])], "image/jpeg")
                except (ValueError, IndexError):
                    self._send(b"", "text/plain", 404)
            else:
                self._send(b"not found", "text/plain", 404)

    return Handler


def serve(video_dir: str | Path = "vids", model: str = "full", port: int = 8000,
          open_browser: bool = True) -> None:
    viewer = Viewer(Path(video_dir), model)
    server = ThreadingHTTPServer(("127.0.0.1", port), _handler(viewer))
    url = f"http://127.0.0.1:{port}/"
    print(f"cleanReps viewer at {url}  (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def export_site(out_dir: str | Path, videos: list[str | Path],
                exercises: list[str] | None = None, model: str = "full",
                max_width: int = 960, quality: int = 80) -> Path:
    """Pre-render ``videos`` into a static site at ``out_dir``.

    Layout: ``index.html``, ``data/index.json`` and ``data/<slug>/{info.json,<i>.jpg}``.
    The source videos themselves are not copied, only the annotated frames.
    """
    out = Path(out_dir)
    if out.exists():
        shutil.rmtree(out)
    entries = []
    for video in map(Path, videos):
        for exercise in exercises or ["squat"]:
            slug = re.sub(r"[^a-z0-9]+", "-", f"{video.stem}-{exercise}".lower()).strip("-")
            print(f"Rendering {video.name} as {exercise}...")
            r = Render(video, exercise, model, max_width=max_width, quality=quality)
            d = out / "data" / slug
            d.mkdir(parents=True)
            for i, jpg in enumerate(r.frames):
                (d / f"{i}.jpg").write_bytes(jpg)
            (d / "info.json").write_text(json.dumps(r.info), encoding="utf-8")
            entries.append({"video": video.name, "exercise": exercise, "slug": slug})
    if not entries:
        raise SystemExit("no videos to export")
    (out / "data" / "index.json").write_text(json.dumps(entries, indent=2), encoding="utf-8")
    (out / "index.html").write_text(page("static"), encoding="utf-8")
    (out / ".nojekyll").write_text("")  # serve files as-is on GitHub Pages
    return out


def page(mode: str) -> str:
    """The viewer page; ``mode`` is "live" (local server API) or "static" (pre-rendered data/)."""
    return PAGE.replace("__MODE__", mode)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cleanReps Viewer</title>
<style>
  :root { color-scheme: dark; --bg:#141517; --panel:#1d1f22; --line:#2d3035; --text:#e8e9eb;
          --muted:#9a9ea5; --accent:#50c878; --warn:#fab428; --bad:#e64a4a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.4 system-ui, sans-serif; }
  header { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:12px 16px;
           border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0 12px 0 0; }
  select, button { background:var(--panel); color:var(--text); border:1px solid var(--line);
                   border-radius:6px; padding:6px 10px; font:inherit; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  main { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:16px; padding:16px; }
  @media (max-width: 900px) { main { grid-template-columns:1fr; } }
  #stage { background:#000; border-radius:8px; overflow:hidden; aspect-ratio:16/9;
           display:flex; align-items:center; justify-content:center; color:var(--muted); }
  #stage img { width:100%; height:100%; object-fit:contain; display:block; }
  .controls { display:flex; gap:8px; align-items:center; margin-top:10px; }
  #seek { flex:1; accent-color:var(--accent); }
  #time { font-variant-numeric:tabular-nums; color:var(--muted); min-width:96px; text-align:right; }
  .marks { position:relative; height:8px; margin:4px 0 0; }
  .marks span { position:absolute; top:0; height:8px; border-radius:2px; cursor:pointer; }
  aside { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  aside h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
             margin:0 0 8px; }
  .stat { font-size:28px; font-weight:600; }
  .hint { color:var(--muted); font-size:12px; margin:6px 0 14px; }
  ul { list-style:none; padding:0; margin:0; }
  li { padding:6px 8px; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; }
  li:hover, li.active { background:var(--line); }
  .ok { color:var(--accent); } .warn { color:var(--warn); } .bad { color:var(--bad); }
</style>
</head>
<body>
<header>
  <h1>cleanReps</h1>
  <select id="video"></select>
  <select id="exercise"></select>
  <button id="load">Analyze</button>
  <span id="status" class="hint" style="margin:0"></span>
</header>
<main>
  <section>
    <div id="stage">Pick a video and press Analyze</div>
    <div class="marks" id="marks"></div>
    <div class="controls">
      <button id="play" disabled>Play</button>
      <button id="restart" disabled>Replay</button>
      <input id="seek" type="range" min="0" max="0" value="0" disabled>
      <select id="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>2</option></select>
      <span id="time">0.00 / 0.00s</span>
    </div>
    <p class="hint">Space: play/pause &middot; &larr;/&rarr;: step one frame</p>
  </section>
  <aside>
    <h2>Summary</h2>
    <div class="stat" id="count">&ndash;</div>
    <div class="hint" id="detail"></div>
    <h2>Reps</h2>
    <ul id="reps"></ul>
  </aside>
</main>
<script>
const $ = id => document.getElementById(id);
const MODE = '__MODE__';  // 'live': local server analyzes on demand; 'static': pre-rendered data/
let info = null, frames = [], idx = 0, playing = false, timer = null, entries = [];
const img = new Image();

const opts = (list, sel) => list.map(v => `<option ${v === sel ? 'selected' : ''}>${v}</option>`).join('');

async function init() {
  if (MODE === 'static') {
    entries = await (await fetch('data/index.json')).json();
    $('load').textContent = 'Load';
    $('video').innerHTML = opts([...new Set(entries.map(e => e.video))]);
    const fillExercises = () => $('exercise').innerHTML =
      opts(entries.filter(e => e.video === $('video').value).map(e => e.exercise), 'squat');
    $('video').onchange = fillExercises;
    fillExercises();
    if (entries.length) analyze();
  } else {
    const r = await (await fetch('/api/videos')).json();
    $('video').innerHTML = opts(r.videos);
    $('exercise').innerHTML = opts(r.exercises, 'squat');
    if (r.videos.length) analyze();
  }
}

async function fetchRender(video, exercise) {
  if (MODE === 'static') {
    const e = entries.find(e => e.video === video && e.exercise === exercise);
    const res = await fetch(`data/${e.slug}/info.json`);
    return [res, await res.json(), i => `data/${e.slug}/${i}.jpg`];
  }
  const res = await fetch('/api/render?' + new URLSearchParams({video, exercise}));
  const stamp = Date.now();
  return [res, await res.json(), i => `/frame/${i}?v=${stamp}`];
}

async function analyze() {
  pause();
  $('load').disabled = true;
  $('status').textContent = MODE === 'static' ? 'Loading…' : 'Analyzing… (runs pose detection on every frame)';
  const [res, data, frameUrl] = await fetchRender($('video').value, $('exercise').value);
  $('load').disabled = false;
  if (!res.ok) { $('status').textContent = data.error || 'Failed to load'; return; }
  info = data;
  let loaded = 0;
  frames = await Promise.all(Array.from({length: info.frames}, (_, i) => new Promise(ok => {
    const im = new Image();
    im.onload = im.onerror = () => { $('status').textContent = `Loading frames ${++loaded}/${info.frames}`; ok(im); };
    im.src = frameUrl(i);
  })));
  $('status').textContent = '';
  $('stage').innerHTML = ''; $('stage').appendChild(img);
  $('seek').max = info.frames - 1;
  for (const b of ['play', 'restart', 'seek']) $(b).disabled = false;
  renderSidebar();
  show(0); play();
}

function renderSidebar() {
  const s = info.summary, dur = info.frames / info.fps;
  $('count').textContent = `${s.reps} reps`;
  $('detail').innerHTML = `${s.clean_reps} clean · ${s.partial_reps} partial` +
    (s.avg_down_s != null ? `<br>Tempo ${s.avg_down_s}s down / ${s.avg_up_s}s up` : '') +
    `<br>${info.camera_hint}`;
  $('reps').innerHTML = info.reps.map((r, i) => {
    const [cls, label] = r.clean ? ['ok', 'clean'] : r.counted ? ['warn', r.faults.join(', ')] : ['bad', 'partial'];
    return `<li data-i="${i}"><span>${r.counted ? 'Rep ' + r.index : 'No rep'}</span><span class="${cls}">${label}</span></li>`;
  }).join('');
  $('marks').innerHTML = info.reps.map((r, i) => {
    const color = r.clean ? 'var(--accent)' : r.counted ? 'var(--warn)' : 'var(--bad)';
    return `<span data-i="${i}" title="${r.counted ? 'Rep ' + r.index : 'Partial'}" style="left:${r.start_s / dur * 100}%;` +
           `width:${Math.max((r.end_s - r.start_s) / dur * 100, .5)}%;background:${color}"></span>`;
  }).join('');
  for (const el of document.querySelectorAll('[data-i]'))
    el.onclick = () => { pause(); show(Math.round(info.reps[el.dataset.i].start_s * info.fps)); play(); };
}

function show(i) {
  idx = Math.max(0, Math.min(i, frames.length - 1));
  img.src = frames[idx].src;
  $('seek').value = idx;
  const t = idx / info.fps;
  $('time').textContent = `${t.toFixed(2)} / ${(frames.length / info.fps).toFixed(2)}s`;
  document.querySelectorAll('#reps li').forEach((li, k) =>
    li.classList.toggle('active', t >= info.reps[k].start_s && t <= info.reps[k].end_s));
}

function play() {
  if (!info) return;
  if (idx >= frames.length - 1) show(0);
  playing = true; $('play').textContent = 'Pause';
  const start = performance.now(), from = idx;
  const tick = () => {
    if (!playing) return;
    const i = from + Math.floor((performance.now() - start) / 1000 * info.fps * +$('speed').value);
    if (i >= frames.length) { show(frames.length - 1); pause(); return; }
    if (i !== idx) show(i);
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}

function pause() { playing = false; cancelAnimationFrame(timer); $('play').textContent = 'Play'; }

$('load').onclick = analyze;
$('play').onclick = () => playing ? pause() : play();
$('restart').onclick = () => { pause(); show(0); play(); };
$('seek').oninput = e => { pause(); show(+e.target.value); };
$('speed').onchange = () => { if (playing) { pause(); play(); } };
document.addEventListener('keydown', e => {
  if (!info || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
  if (e.code === 'ArrowRight') { pause(); show(idx + 1); }
  if (e.code === 'ArrowLeft') { pause(); show(idx - 1); }
});
init();
</script>
</body>
</html>
"""
