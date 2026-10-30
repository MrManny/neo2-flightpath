---
"neo2-flightpath": minor
---

Add a settings panel to the desktop app (cog button): map style, view, zoom/zoom-out, intro/outro seconds and HUD chips mirror the CLI option vocabulary and restyle the preview instantly, without reloading the recording. Look changes fetch any missing map tiles on demand through the polite downloader (2.0 req/s), and the `alt` chip hides itself automatically when the telemetry has no altitude, matching the CLI rule.
