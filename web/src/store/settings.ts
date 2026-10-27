// Training options, kept in localStorage on this device.

import { useState } from "react";
import { AVERAGE_BODY, BODY_SIZES, type Body } from "../engine/exercise";
import { defaultModel, type ModelVariant } from "../pose/landmarker";

export interface Settings {
  body: Body;
  /** Spoken cues. */
  voice: boolean;
  /** Record the set for replay on the summary screen. */
  replay: boolean;
  model: ModelVariant;
}

const KEYS = { body: "cleanreps.body", voice: "cleanreps.voice", replay: "cleanreps.replay", model: "cleanreps.model" };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable: fall back to defaults
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts this visit only */
  }
}

function loadBody(): Body {
  try {
    const saved = JSON.parse(read(KEYS.body) ?? "null");
    if (BODY_SIZES.includes(saved?.femur) && BODY_SIZES.includes(saved?.torso)) return saved;
  } catch {
    /* corrupt: fall back to average */
  }
  return AVERAGE_BODY;
}

function loadModel(): ModelVariant {
  // A ?model= override in the URL wins over the saved choice.
  if (new URLSearchParams(location.search).has("model")) return defaultModel();
  const saved = read(KEYS.model);
  return saved === "lite" || saved === "full" ? saved : defaultModel();
}

export function loadSettings(): Settings {
  return { body: loadBody(), voice: read(KEYS.voice) !== "off", replay: read(KEYS.replay) !== "off", model: loadModel() };
}

function save(s: Settings) {
  write(KEYS.body, JSON.stringify(s.body));
  write(KEYS.voice, s.voice ? "on" : "off");
  write(KEYS.replay, s.replay ? "on" : "off");
  write(KEYS.model, s.model);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(loadSettings);
  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    save(next);
  };
  return [settings, update];
}
