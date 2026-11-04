// Holds the camera picture back a few frames, so a pose can be smoothed with the
// frames after it and still be drawn on the picture it came from.

const newCanvas = () => document.createElement("canvas");

/** Each frame in goes on screen `delay` frames later. Until there are that many, the first stays up. */
export class DelayedFrames {
  private readonly buffer: HTMLCanvasElement[];
  private readonly contexts: CanvasRenderingContext2D[];
  private count = 0;

  constructor(private readonly display: CanvasRenderingContext2D, private readonly delay: number, makeCanvas = newCanvas) {
    this.buffer = Array.from({ length: delay + 1 }, makeCanvas);
    this.contexts = this.buffer.map((c) => c.getContext("2d", { alpha: false })!);
  }

  push(video: CanvasImageSource, width: number, height: number): void {
    const { buffer, contexts, delay, display } = this;
    if (display.canvas.width !== width || display.canvas.height !== height) {
      for (const canvas of [...buffer, display.canvas]) Object.assign(canvas, { width, height });
      this.count = 0; // what's in the buffer was another size
    }
    contexts[this.count % buffer.length].drawImage(video, 0, 0, width, height);
    display.drawImage(buffer[Math.max(this.count - delay, 0) % buffer.length], 0, 0);
    this.count++;
  }
}
