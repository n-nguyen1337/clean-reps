import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptDisclaimer, cameraPermission, describeStartError, disclaimerAccepted, rememberCamera } from "../consent";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("disclaimer", () => {
  it("is shown until accepted", () => {
    expect(disclaimerAccepted()).toBe(false);
    acceptDisclaimer();
    expect(disclaimerAccepted()).toBe(true);
  });

  it("is asked again when the wording version changes", () => {
    localStorage.setItem("cleanreps.disclaimer", "0");
    expect(disclaimerAccepted()).toBe(false);
  });

  it("is shown when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => acceptDisclaimer()).not.toThrow();
    expect(disclaimerAccepted()).toBe(false);
  });
});

describe("cameraPermission", () => {
  const permissions = (state: PermissionState | Error) => vi.stubGlobal("navigator", {
    permissions: { query: async () => { if (state instanceof Error) throw state; return { state }; } },
  });

  it("follows the Permissions API", async () => {
    permissions("granted");
    expect(await cameraPermission()).toBe("granted");
    permissions("denied");
    expect(await cameraPermission()).toBe("denied");
    permissions("prompt");
    expect(await cameraPermission()).toBe("ask");
  });

  it("falls back to whether the camera worked before", async () => {
    permissions(new TypeError("camera is not a valid PermissionName"));
    expect(await cameraPermission()).toBe("ask");
    rememberCamera();
    expect(await cameraPermission()).toBe("granted");
  });
});

describe("describeStartError", () => {
  const err = (name: string) => new DOMException("", name);

  it("explains a blocked camera per platform", () => {
    expect(describeStartError(err("NotAllowedError"), false).help).toMatch(/address bar/);
    expect(describeStartError(err("NotAllowedError"), true).help).toMatch(/Settings › Apps › Safari/);
  });

  it("recognises missing and busy cameras", () => {
    expect(describeStartError(err("NotFoundError"), false).title).toBe("No camera found");
    expect(describeStartError(err("NotReadableError"), false).title).toBe("The camera is busy");
  });

  it("doesn't offer a retry that can't work", () => {
    expect(describeStartError(err("SecurityError"), false).retry).toBe(false);
  });

  it("passes other failures through", () => {
    const e = describeStartError(new Error("model fetch failed"), false);
    expect(e).toEqual({ title: "Couldn't start", help: "model fetch failed", retry: true });
  });
});
