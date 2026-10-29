import { isClean, type RepResult } from "../engine/exercise";

const toneOf = (r: RepResult) => isClean(r) ? "clean" : r.counted ? "faulted" : "missed";

/** Counts behind a strip, for its label and legend. */
export function repCounts(reps: RepResult[]) {
  const clean = reps.filter(isClean).length;
  const missed = reps.filter((r) => !r.counted).length;
  return { clean, faulted: reps.length - clean - missed, missed };
}

/** A set at a glance: one tick per rep, in order. Clean reps carry the accent; the rest are status marks. */
export function RepStrip({ reps, size = "small", legend = false }: {
  reps: RepResult[]; size?: "small" | "large"; legend?: boolean;
}) {
  const n = repCounts(reps);
  const label = `${n.clean} clean, ${n.faulted} with faults, ${n.missed} not counted`;
  return (
    <div className={`rep-strip ${size}`}>
      <div className="rep-ticks" role="img" aria-label={label}>
        {reps.map((r, i) => <i key={i} className={toneOf(r)} />)}
      </div>
      {legend && (
        <div className="rep-legend" aria-hidden="true">
          <span><i className="clean" />Clean {n.clean}</span>
          <span><i className="faulted" />Faults {n.faulted}</span>
          {n.missed > 0 && <span><i className="missed" />Not counted {n.missed}</span>}
        </div>
      )}
    </div>
  );
}
