// The user's own Anthropic API key, kept in this browser only.

const KEY_STORAGE = "cleanreps.anthropicKey";

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable: the key lasts this visit only */
  }
}
