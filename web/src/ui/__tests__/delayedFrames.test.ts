import { describe, expect, it } from "vitest";
import { DelayedFrames } from "../delayedFrames";

/** A canvas that remembers what was last drawn on it. */
function fakeCanvas() {
  const canvas = {
    width: 300, height: 150, content: null as unknown,
    getContext: () => context,
  };
  const context = {
    canvas,
    drawImage(source: { content?: unknown } | string) {
      canvas.content = typeof source === "string" ? source : source.content;
    },
  };
  return canvas;
}

function setup(delay: number) {
  const screen = fakeCanvas();
  const made: ReturnType<typeof fakeCanvas>[] = [];
  const frames = new DelayedFrames(screen.getContext() as unknown as CanvasRenderingContext2D, delay, () => {
    const c = fakeCanvas();
    made.push(c);
    return c as unknown as HTMLCanvasElement;
  });
  const push = (frame: string, width = 720, height = 1280) => {
    frames.push(frame as unknown as CanvasImageSource, width, height);
    return screen.content;
  };
  return { push, screen, made };
}

describe("DelayedFrames", () => {
  it("shows each frame after the delay", () => {
    const { push } = setup(2);
    expect(["a", "b", "c", "d", "e", "f", "g"].map((f) => push(f))).toEqual(["a", "a", "a", "b", "c", "d", "e"]);
  });

  it("shows frames at once with no delay", () => {
    const { push } = setup(0);
    expect(["a", "b", "c"].map((f) => push(f))).toEqual(["a", "b", "c"]);
  });

  it("sizes the screen and its buffer to the frames", () => {
    const { push, screen, made } = setup(2);
    push("a");
    for (const c of [screen, ...made]) expect([c.width, c.height]).toEqual([720, 1280]);
  });

  it("starts over when the frame size changes, instead of showing a frame of the old size", () => {
    const { push } = setup(2);
    ["a", "b", "c", "d"].forEach((f) => push(f));
    expect(push("x", 1280, 720)).toBe("x");
    expect(push("y", 1280, 720)).toBe("x");
    expect(push("z", 1280, 720)).toBe("x");
    expect(push("w", 1280, 720)).toBe("y");
  });
});
