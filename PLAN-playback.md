# cleanReps Set Playback — Plan

| | |
|---|---|
| **Status** | P1–P3 implemented; P4 not started |
| **Plan version** | 0.2 |
| **Last updated** | 2026-10-27 |

## Concept

The summary screen explains a set with numbers and charts, but you can't see the rep a chart is talking about. Playback records the set while it runs. The summary then replays it with the pose skeleton drawn over the video, and a timeline marks every rep and its faults. Tap rep 4's "chest forward" and the video jumps to rep 4's bottom.

The recording lives in memory for the summary screen only. It's never stored, synced or uploaded, and it's gone once you leave the summary.

## Decisions

| Question | Choice | Why |
|---|---|---|
| What's replayed | The real camera video with the skeleton overlaid | You can see form faults on your own body. A stick figure alone hides things the metrics miss, like bar path or foot position. |
| Retention | The summary screen only, held as an in-memory `Blob` | No storage quota, cleanup or sync work. Past sets in Progress have no playback. That can come later if people ask. |
| Privacy | Recording is on by default, with a "Record for playback" setting to turn it off | Turning it off restores today's behaviour exactly. The copy changes from "no video is recorded" to "video is recorded for replay on this device only and is never saved or uploaded". |
| Recorder | `MediaRecorder` on the existing camera stream | No second `getUserMedia` call and no re-encoding library. It's supported in every browser the app targets: Chrome, Edge, Firefox, and Safari 14.1+. |
| Format | MP4 (H.264) when `isTypeSupported` allows it, otherwise WebM | MP4 seeks reliably everywhere. Chrome's WebM recordings have no duration, which breaks the scrubber until it's fixed (see Risks). |
| Bitrate and cap | About 2.5 Mbps at the camera's 720p, recording stops after 4 minutes | Roughly 19 MB per minute, so at most about 75 MB in memory. The analysis keeps running after the cap, and later reps show as not recorded. |
| Skeleton source | The poses captured live, not a second pass of the model over the video | The overlay shows exactly what the engine saw and scored. A second pass would be slow on phones and could disagree with the scores. |

## How it fits together

```
 LiveSession                                     Summary
┌───────────────────────────────┐              ┌──────────────────────────────┐
│ camera stream ──► <video> ──► landmarker      │ Playback                     │
│      │                         │              │  <video src=blob> + <canvas> │
│      ▼                         ▼              │        ▲            ▲        │
│ MediaRecorder            PoseTrack.push(t, pose)    │ seek          │ pose at t │
│      │                         │              │  Timeline: rep segments,     │
│      └──── onDone(record, playback) ──────────┼─►  fault markers, scrubber   │
└───────────────────────────────┘              │  Charts/table: tap → seek    │
                                               └──────────────────────────────┘
```

### Clock alignment

The engine's clock is `t = (performance.now() - start) / 1000`, where `start` is taken right after `video.play()` ([LiveSession.tsx](web/src/ui/LiveSession.tsx)). A set time `t` is video time `t - offsetS`. Rep timings (`startS`, `bottomS`, `endS`) and trace samples need no conversion.

`offsetS` is anchored on the **end** of the recording: the player sets it to the stop time minus the video's duration (`alignOffset()` in [playback.ts](web/src/playback/playback.ts)). Anchoring on the start doesn't work. In testing, the recorder's `start` event came 0.25 s to 3 s after capture began, depending on how cold the encoder was. Until the duration is known, the time of the `start()` call stands in.

### `Playback`, passed beside the `SessionRecord`

```ts
interface Playback {
  video: Blob;
  mimeType: string;
  offsetS: number;          // start estimate; the player refines it with alignOffset()
  endS: number;             // set time when recording stopped
  width: number; height: number;
  poses: PoseTrack;         // every processed frame, for the overlay
}
// LiveSession's onDone(record, playback) → App's summary screen → <Summary playback>
```

It travels next to the `SessionRecord` rather than inside it, so the engine types stay free of browser media types.

`PoseTrack` holds frame times in a `Float64Array` and the image landmarks of the 33 points × (x, y, visibility) in a growable `Float32Array`. At 30 fps that's about 12 KB per second, or about 3 MB for the 4-minute cap. Look up the pose for a time with a binary search on the frame times.

Because `playback` never reaches `toSetRecord()`, nothing new is saved or synced. `toSessionRecord()` stays as it is, and past sets show no playback section.

## UI

A **Replay** section at the top of the summary, above Takeaways, shown only when `record.playback` exists:

- **Stage**: the video with a canvas over it, mirrored like the live view (`.stage` uses `scaleX(-1)`). Draw the skeleton with the live screen's `drawPose`, moved to a shared module. Use `requestVideoFrameCallback` to draw the pose for each frame's `mediaTime`, falling back to `requestAnimationFrame`.
- **Overlay text**: the current rep and its verdict ("Rep 3: clean", "Rep 4: chest forward"), plus the primary metric value at this moment, read from the 10 Hz trace.
- **Timeline** under the video: one segment per rep, coloured clean, fault or partial. A tick marks each bottom, and you drag to scrub.
- **Controls**: play/pause, speed (0.25×, 0.5×, 1×), step one frame back or forward, previous/next rep, and "Loop this rep".
- **Links from the existing analysis**: tapping a rep row in the table, a point on a rule or tempo chart, or a fault in "What to work on" plays that rep and scrolls the player into view. Tapping the trace chart seeks to that moment, and the chart draws a cursor at the replay's position.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| **P1 Record** | `MediaRecorder` in LiveSession, format picking, offset capture, `PoseTrack`, passing `Playback` to the summary, the 4-minute cap, the setting, and the privacy copy in the app | Finishing a set gives the summary a playable Blob, and the setting turns recording off |
| **P2 Player** | Shared `drawPose`, a `Playback` component with the overlay, a timeline with rep segments, and the basic controls | Scrubbing shows the skeleton lined up with the body in Chrome desktop, Chrome Android and iOS Safari |
| **P3 Linking** | Seeking from the table, charts and faults; the trace chart cursor; loop rep; frame step; speed | Tapping any rep anywhere on the summary plays that rep |
| **P4 (optional)** | A "Save video" button that downloads the clip, with the overlay burned in through canvas `captureStream()` | |

## Risks and edge cases

- **WebM with no duration (Chrome)**: `video.duration` is `Infinity`, so seeking fails. Prefer MP4 (Chrome 126+ records it). Otherwise use the known workaround: set `currentTime` to a huge value, wait for `durationchange`, then reset. As a last resort, base the timeline on the set's own duration.
- **iOS Safari**: it records `video/mp4` only. Test that the camera preview doesn't stutter while recording, and lower the bitrate if it does.
- **Memory**: free the object URL and the Blob when the summary unmounts or "Go again" starts a new set. Stop recording at 4 minutes and keep the analysis running. The timeline marks the rest of the set "not recorded".
- **Alignment drift**: anchoring on the end fixes the offset at the end of the set. Any drift would show up at the start of a long set, so check that on a phone.
- **Low frame rate on phones**: the overlay holds the last pose between processed frames. At the Lite model's frame rate that's acceptable.
- **No `MediaRecorder` or an error mid-set**: skip playback quietly. The summary looks as it does today.

## Testing

Verified so far in headless Edge, using a squat clip as the fake camera (`--use-file-for-fake-video-capture`). Recording was MP4/H.264. The skeleton lined up with the body on reps 1 and 2, on both a cold and a warm start. With the cap temporarily set to 8 s, the timeline marked the rest of the set as not recorded and disabled the chips for the later reps.

- **Unit (vitest)**: `PoseTrack` lookup (exact time, between frames, before the first frame, after the last), MIME selection given `isTypeSupported`, mapping reps to timeline segments, and finding the rep at a time.
- **Manual matrix**: Chrome desktop, Chrome Android and iOS Safari, each with the Lite and Full models and a 30-second and a 5-minute set. Check seeking, alignment, memory use (Chrome task manager), and that turning the setting off records nothing.
