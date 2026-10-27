import { useEffect, useMemo, useState } from "react";
import {
  ACHIEVEMENTS, CATEGORIES, EXERCISES, progressOf, type AchievementDef, type Category, type Progression, type SetProgress,
} from "../store/achievements";
import { TIER_XP, type Level } from "../store/level";
import type { SetRecord } from "../store/record";

const fmt = (n: number) => n.toLocaleString();
const pctOf = (l: Level) => (l.xp - l.levelXp) / (l.nextXp - l.levelXp);

/** Fills from `from` (0–1) to `to` once mounted. */
function XpBar({ to, from = to }: { to: number; from?: number }) {
  const [width, setWidth] = useState(from);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(to));
    return () => cancelAnimationFrame(id);
  }, [to]);
  return <span className="xp-bar"><i style={{ width: `${Math.round(width * 100)}%` }} /></span>;
}

export function LevelCard({ level, unlocked }: { level: Level; unlocked: number }) {
  return (
    <section className="level-card">
      <div className="level-num"><b>{level.level}</b><span>level</span></div>
      <div className="level-info">
        <div className="level-head"><b>{level.rank}</b><span>{unlocked} / {ACHIEVEMENTS.length} achievements</span></div>
        <XpBar to={pctOf(level)} />
        <span className="hint small">{fmt(level.xp - level.levelXp)} / {fmt(level.nextXp - level.levelXp)} XP to level {level.level + 1}</span>
      </div>
    </section>
  );
}

function Badge({ def, prog, onSelect }: { def: AchievementDef; prog: Progression; onSelect?: (def: AchievementDef) => void }) {
  const unlocked = !!prog.unlocked[def.id];
  const secret = def.hidden && !unlocked;
  const progress = unlocked || secret ? null : progressOf(def, prog.stats);
  return (
    <button className={`badge ${def.tier}${unlocked ? "" : " locked"}`} onClick={onSelect && (() => onSelect(def))}
      aria-label={`${secret ? "Secret achievement" : def.title}, ${unlocked ? "unlocked" : "locked"}`}>
      <span className="badge-ring" aria-hidden="true">{secret ? "?" : def.emoji}</span>
      <b>{secret ? "???" : def.title}</b>
      {def.exercise && !secret && <small>{EXERCISES[def.exercise].name}</small>}
      {progress && <span className="meter" aria-hidden="true"><i style={{ width: `${(progress.value / progress.target) * 100}%` }} /></span>}
    </button>
  );
}

function AchievementSheet({ def, prog, sets, onOpen, onClose }: {
  def: AchievementDef; prog: Progression; sets: SetRecord[]; onOpen: (set: SetRecord) => void; onClose: () => void;
}) {
  const unlock = prog.unlocked[def.id];
  const secret = def.hidden && !unlock;
  const progress = unlock || secret ? null : progressOf(def, prog.stats);
  const set = unlock && sets.find((s) => s.id === unlock.setId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={secret ? "Secret achievement" : def.title}
        onClick={(e) => e.stopPropagation()}>
        <span className={`badge-ring big ${def.tier}${unlock ? "" : " locked"}`} aria-hidden="true">{secret ? "?" : def.emoji}</span>
        <h2>{secret ? "Secret achievement" : def.title}</h2>
        <p className="tier-line">
          {def.tier[0].toUpperCase() + def.tier.slice(1)} · {TIER_XP[def.tier]} XP
          {def.exercise && !secret && <> · {EXERCISES[def.exercise].name}</>}
        </p>
        <p>{secret ? "Keep training to find out." : def.description}</p>
        {progress && (
          <>
            <span className="meter"><i style={{ width: `${(progress.value / progress.target) * 100}%` }} /></span>
            <p className="hint small">{fmt(progress.value)} / {fmt(progress.target)}</p>
          </>
        )}
        {unlock && (
          <p className="hint">
            Unlocked {new Date(unlock.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            {set ? "" : " (that set was deleted)"}
          </p>
        )}
        <div className="row tight">
          {set && <button className="primary" onClick={() => onOpen(set)}>Open set</button>}
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function useSheet(prog: Progression, sets: SetRecord[], onOpen: (set: SetRecord) => void) {
  const [selected, setSelected] = useState<AchievementDef | null>(null);
  const sheet = selected && (
    <AchievementSheet def={selected} prog={prog} sets={sets} onOpen={onOpen} onClose={() => setSelected(null)} />
  );
  return [sheet, setSelected] as const;
}

/** Latest unlocks and the ones closest to unlocking, for the Progress page. */
export function AchievementTeaser({ prog, sets, onOpen, onSeeAll }: {
  prog: Progression; sets: SetRecord[]; onOpen: (set: SetRecord) => void; onSeeAll: () => void;
}) {
  const [sheet, select] = useSheet(prog, sets, onOpen);
  const recent = useMemo(() => ACHIEVEMENTS.filter((d) => prog.unlocked[d.id])
    .sort((a, b) => prog.unlocked[b.id].at.localeCompare(prog.unlocked[a.id].at)).slice(0, 3), [prog]);
  const next = useMemo(() => ACHIEVEMENTS
    .filter((d) => !prog.unlocked[d.id] && !d.hidden)
    .map((d) => ({ d, p: progressOf(d, prog.stats) }))
    .filter(({ p }) => p && p.value > 0)
    .sort((a, b) => b.p!.value / b.p!.target - a.p!.value / a.p!.target)
    .slice(0, 3).map(({ d }) => d), [prog]);

  return (
    <>
      <div className="title-row section">
        <h2>Achievements</h2>
        <button className="ghost" onClick={onSeeAll}>See all</button>
      </div>
      {recent.length > 0 && <p className="hint small">Latest</p>}
      <div className="badges">{recent.map((d) => <Badge key={d.id} def={d} prog={prog} onSelect={select} />)}</div>
      {next.length > 0 && <p className="hint small">Almost there</p>}
      <div className="badges">{next.map((d) => <Badge key={d.id} def={d} prog={prog} onSelect={select} />)}</div>
      {sheet}
    </>
  );
}

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "squat", label: "Squat", test: (d: AchievementDef) => d.exercise === "squat" },
  { key: "pushup", label: "Push-up", test: (d: AchievementDef) => d.exercise === "pushup" },
  { key: "unlocked", label: "Unlocked", test: (d: AchievementDef, p: Progression) => !!p.unlocked[d.id] },
] as const;

export function AchievementBoard({ prog, sets, onOpen, onBack }: {
  prog: Progression; sets: SetRecord[]; onOpen: (set: SetRecord) => void; onBack: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [sheet, select] = useSheet(prog, sets, onOpen);
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const shown = ACHIEVEMENTS.filter((d) => test(d, prog));
  const count = ACHIEVEMENTS.filter((d) => prog.unlocked[d.id]).length;

  return (
    <main className="page">
      <h1>Achievements</h1>
      <LevelCard level={prog.level} unlocked={count} />
      <div className="segmented" style={{ gridTemplateColumns: `repeat(${FILTERS.length}, 1fr)` }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={f.key === filter ? "selected" : ""} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {(Object.keys(CATEGORIES) as Category[]).map((cat) => {
        const defs = shown.filter((d) => d.category === cat);
        if (!defs.length) return null;
        return (
          <section key={cat}>
            <h2>{CATEGORIES[cat]}</h2>
            <div className="badges">{defs.map((d) => <Badge key={d.id} def={d} prog={prog} onSelect={select} />)}</div>
          </section>
        );
      })}
      {shown.length === 0 && <p className="hint">Nothing unlocked yet. Finish a set to earn your first achievement.</p>}
      <div className="row">
        <button className="primary" onClick={onBack}>Back to progress</button>
      </div>
      {sheet}
    </main>
  );
}

/** On the Summary screen right after a set: XP gained, level-ups and new achievements. */
export function SetProgressPanel({ progress }: { progress: SetProgress }) {
  const { before, after, xp, unlocked } = progress;
  const levelUp = after.level > before.level;
  return (
    <section className="set-progress">
      {levelUp && (
        <p className="level-up" role="status">
          Level up! Level {after.level}{after.rank !== before.rank && <> · {after.rank}</>}
        </p>
      )}
      <div className="level-head"><b>+{fmt(xp)} XP</b><span>Level {after.level} · {after.rank}</span></div>
      <XpBar from={levelUp ? 0 : pctOf(before)} to={pctOf(after)} />
      {unlocked.length > 0 && (
        <>
          <p className="hint small">New {unlocked.length === 1 ? "achievement" : "achievements"}</p>
          <div className="badges">{unlocked.map((d) => <EarnedBadge key={d.id} def={d} />)}</div>
        </>
      )}
    </section>
  );
}

/** On a reopened past set: what it earned, without the animation. */
export function EarnedInSet({ xp, earned }: { xp: number; earned: AchievementDef[] }) {
  return (
    <section className="set-progress">
      <div className="level-head"><b>+{fmt(xp)} XP</b><span>from this set</span></div>
      {earned.length > 0 && (
        <>
          <p className="hint small">Earned in this set</p>
          <div className="badges">{earned.map((d) => <EarnedBadge key={d.id} def={d} />)}</div>
        </>
      )}
    </section>
  );
}

function EarnedBadge({ def }: { def: AchievementDef }) {
  return (
    <div className={`badge ${def.tier}`}>
      <span className="badge-ring" aria-hidden="true">{def.emoji}</span>
      <b>{def.title}</b>
      {def.exercise && <small>{EXERCISES[def.exercise].name}</small>}
    </div>
  );
}
