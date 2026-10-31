---
"neo2-flightpath": patch
---

Keyboard shortcuts now always act on the current player state: a key pressed in the instant between a UI update and its effect cleanup could hit a stale handler and do nothing (most visibly Space right when tile warm-up finished, which then left the arrow keys unable to park playback).
