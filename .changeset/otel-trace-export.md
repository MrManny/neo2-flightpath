---
"neo2-flightpath": minor
---

Add opt-in OpenTelemetry trace export for the render pipeline (OTLP/HTTP protobuf); nothing is loaded or sent unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (#14).
