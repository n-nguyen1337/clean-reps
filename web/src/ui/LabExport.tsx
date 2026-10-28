import { useState } from "react";
import type { SessionRecord } from "../engine/session";
import { labFiles, saveFiles } from "../playback/lab";
import type { LabCapture } from "./LiveSession";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/** Lab mode only: save the set's video, raw landmarks and draft labels for threshold tuning. */
export function LabExport({ record, capture }: { record: SessionRecord; capture: LabCapture }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const { log, recording } = capture;

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
        {state.kind === "busy" ? "Preparing…" : "Export clip for tuning"}
      </button>
      <p className="hint small">
        Lab mode: {log.frames.length} frames · {log.model} model
        {recording ? ` · ${(recording.video.size / 1e6).toFixed(1)} MB video` : " · no video"}
      </p>
      {state.kind === "done" && <p className="hint small">{state.text}</p>}
      {state.kind === "error" && <p className="error">{state.text}</p>}
    </div>
  );
}
