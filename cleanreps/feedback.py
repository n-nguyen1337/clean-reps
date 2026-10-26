"""Turns a stream of cues into one readable message at a time."""

from __future__ import annotations

import queue
import threading

from .exercises import Cue


class CueManager:
    """Shows one cue at a time, highest priority first.

    A cue stays on screen for ``display_s``. A higher-priority cue can replace
    it early; a lower-priority one waits. The same cue id is not repeated
    within ``cooldown_s``, so a persistent fault doesn't spam the user.
    """

    def __init__(self, display_s: float = 2.0, cooldown_s: float = 4.0,
                 speaker: Speaker | None = None):
        self.display_s = display_s
        self.cooldown_s = cooldown_s
        self.speaker = speaker
        self._active: Cue | None = None
        self._active_since = 0.0
        self._last_shown: dict[str, float] = {}

    def push(self, cues: list[Cue], t: float) -> None:
        for cue in sorted(cues, key=lambda c: c.priority, reverse=True):
            if t - self._last_shown.get(cue.id, -1e9) < self.cooldown_s:
                continue
            active = self.current(t)
            if active is not None and active.priority > cue.priority:
                continue
            self._active, self._active_since = cue, t
            self._last_shown[cue.id] = t
            if self.speaker is not None:
                self.speaker.say(cue.text)
            return

    def current(self, t: float) -> Cue | None:
        if self._active is not None and t - self._active_since > self.display_s:
            self._active = None
        return self._active


class Speaker:
    """Text-to-speech on a background thread. Drops lines while busy so
    audio never falls behind the workout."""

    def __init__(self, rate: int = 185):
        self._queue: queue.Queue[str | None] = queue.Queue(maxsize=1)
        self._thread = threading.Thread(target=self._run, args=(rate,), daemon=True)
        self._thread.start()

    def say(self, text: str) -> None:
        try:
            self._queue.put_nowait(text)
        except queue.Full:
            pass

    def close(self) -> None:
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass

    def _run(self, rate: int) -> None:
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", rate)
        except Exception as exc:  # no TTS backend available: stay silent
            print(f"Audio cues disabled: {exc}")
            return
        while (text := self._queue.get()) is not None:
            engine.say(text)
            engine.runAndWait()
