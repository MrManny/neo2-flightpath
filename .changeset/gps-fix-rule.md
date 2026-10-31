---
"neo2-flightpath": patch
---

One rule now decides what counts as a real GPS fix in every telemetry source: exactly (0, 0) is DJI's no-lock placeholder, while near-equator and near-prime-meridian coordinates (like (0.1, 0.1)) count as fixes again instead of being dropped. Fix and no-lock counts agree between the SRT sidecar and camera metadata for the same coordinates; the raw byte-scan fallback still reports 0 no-locks because it sees fix pairs only.
