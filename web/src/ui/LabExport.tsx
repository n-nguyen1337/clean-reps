import { useState } from "react";
import type { SessionRecord } from "../engine/session";
import { labFiles, labTimings, saveFiles } from "../playback/lab";
import type { LabCapture } from "./LiveSession";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/** Lab mode only: save the set's video, skeleton data and draft labels for tuning. */
export function LabExport({ record, capture }: { record: SessionRecord; capture: LabCapture }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const { log, recording } = capture;
  const { copyMs, detectMs, drawMs, dropped } = labTimings(log);

  const exportClip = async () => {
    setState({ kind: "busy" });
    try {
      // Built inside the tap: the share sheet needs the user's gesture.
      const files = labFiles({ exercise: record.summary.exercise, body: record.body, reps: record.reps, log, recording });
      const result = await saveFiles(files);
      setState(result === "cancelled" ? { kind: "idle" }
        : { kind: "done", text: `${result === "shared" ? "Shared" : "Downloaded"} ${files.map((f) => f.name).join(" and ")}` });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="lab-export">
      <button className="ghost" disabled={state.kind === "busy" || log.frames.length === 0} onClick={exportClip}>
        {state.kind === "busy" ? "Preparing…" : "Export video and skeleton"}
      </button>
      <p className="hint small">
        Lab mode: {log.frames.length} frames · {log.model} model
        {recording ? ` · ${(recording.video.size / 1e6).toFixed(1)} MB video` : " · no video"}
        {detectMs !== null && ` · model ${detectMs.toFixed(0)} ms`}
        {copyMs !== null && ` · frame copy ${copyMs.toFixed(0)} ms`}
        {drawMs !== null && ` · skeleton ${drawMs.toFixed(0)} ms`}
        {dropped !== null && ` · ${dropped} camera frames dropped`}
      </p>
      {state.kind === "done" && <p className="hint small">{state.text}</p>}
      {state.kind === "error" && <p className="error">{state.text}</p>}
    </div>
  );
}
