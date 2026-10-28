// First-visit disclaimer and camera permission state, kept in localStorage on this device.

/** Bump when the disclaimer's wording changes, so everyone sees it again. */
const DISCLAIMER_VERSION = "1";

const KEYS = { disclaimer: "cleanreps.disclaimer", camera: "cleanreps.camera" };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: asked again next visit */
  }
}

export const disclaimerAccepted = () => read(KEYS.disclaimer) === DISCLAIMER_VERSION;
export const acceptDisclaimer = () => write(KEYS.disclaimer, DISCLAIMER_VERSION);

/** Remember that the camera worked once, for browsers without a "camera" permission query. */
export const rememberCamera = () => write(KEYS.camera, "ok");

/**
 * What to show before asking for the camera: "ask" when the browser will prompt (explain first),
 * "granted" to start straight away, "denied" when it's blocked and the prompt won't appear.
 */
export async function cameraPermission(): Promise<"ask" | "granted" | "denied"> {
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    if (status.state === "granted" || status.state === "denied") return status.state;
    return "ask";
  } catch {
    // No Permissions API, or it doesn't know "camera" (older Firefox and Safari).
    return read(KEYS.camera) === "ok" ? "granted" : "ask";
  }
}

export interface CameraError {
  title: string;
  help: string;
  /** Trying again can work without changing anything outside the app. */
  retry: boolean;
}

/** Turn a getUserMedia or model-loading failure into something the user can act on. */
export function describeStartError(err: unknown, iOS = /iPhone|iPad|iPod/.test(navigator.userAgent)): CameraError {
  const name = err instanceof Error || err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        title: "Camera access is blocked",
        help: iOS
          ? "Open Settings › Apps › Safari › Camera and choose Allow (or Ask), then come back and try again."
          : "Allow the camera for this site from the icon next to the address bar, then try again.",
        retry: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { title: "No camera found", help: "Connect a camera, or open cleanReps on your phone.", retry: true };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        title: "The camera is busy",
        help: "Another app or tab may be using it. Close it, then try again.",
        retry: true,
      };
    case "SecurityError":
      return { title: "Camera not available here", help: "The camera only works over HTTPS.", retry: false };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { title: "Couldn't start", help: message, retry: true };
}
