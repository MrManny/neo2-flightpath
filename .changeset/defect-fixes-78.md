---
"neo2-flightpath": patch
---

Fix four latent defects from the clean-up review: frames after the last GPS fix now hold that fix instead of jumping back to the flight's start, ffmpeg/ffprobe failures surface their real cause instead of a false "no telemetry found", a throwing export callback can no longer take down the app, and resolved configs no longer share mutable state with the defaults. Odd canvas dimensions now normalize to even at the config layer, and failed tool or browser launches keep their full cause chain.
