---
"neo2-flightpath": patch
---

Diagnostics and contract hardening from the clean-up review: the export progress bar now follows typed capture-progress events instead of scraping log text (and capture progress can no longer duplicate or drop boundary updates under worker races), mistyped numbers in config files and export requests fail fast naming the option instead of being silently coerced, tile paths validate their style inside the parser so the type cannot lie, and the telemetry source/method/heading vocabulary is typed so a typo cannot reach the --json output. The cam meta decoders are pure (with their dead fallbacks gone), CLI error contexts name the documented long flag, and the SRT parser no longer parses the unused wall-clock field.
