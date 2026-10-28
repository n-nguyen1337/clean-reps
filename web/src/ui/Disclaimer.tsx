import { useEffect, useRef } from "react";

/** Shown once, over whatever page the first visit lands on. It can only be closed by accepting. */
export function Disclaimer({ onAccept }: { onAccept: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="disclaimer-title"
      onCancel={(e) => e.preventDefault() /* Escape doesn't count as accepting */}>
      <h2 id="disclaimer-title">Before you train</h2>
      <p className="lede">cleanReps gives general fitness feedback. It isn't medical advice, and it can't diagnose or prevent injury.</p>
      <ul className="sheet-list">
        <li>Check with a doctor first if you have an injury or health condition, or are pregnant.</li>
        <li>Stop if anything hurts, or if you feel dizzy or short of breath.</li>
        <li>Pose tracking can be wrong. Treat cues as suggestions, and go by how your body feels.</li>
        <li>Clear the space around you, and prop the camera where it can't fall.</li>
      </ul>
      <button className="primary big" autoFocus onClick={() => { ref.current?.close(); onAccept(); }}>I understand</button>
    </dialog>
  );
}

/** Shown in the live session before the browser's camera prompt, so the prompt isn't a surprise. */
export function CameraExplainer({ hint, onContinue, onCancel }: {
  hint: string; onContinue: () => void; onCancel: () => void;
}) {
  return (
    <div className="overlay-msg">
      <div className="sheet" role="dialog" aria-labelledby="camera-title">
        <h2 id="camera-title">Camera access</h2>
        <p className="lede">cleanReps uses your camera to track your joints and count reps.</p>
        <ul className="sheet-list">
          <li>Video is processed on this device and is never uploaded.</li>
          <li>Your browser will ask for permission next. Choose <b>Allow</b>.</li>
          <li>{hint}</li>
        </ul>
        <div className="sheet-actions">
          <button className="ghost" onClick={onCancel}>Not now</button>
          <button className="primary" autoFocus onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}
