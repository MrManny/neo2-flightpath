# neo2-flightpath

## 0.2.0

- **New:** See where render time goes — opt-in OpenTelemetry traces for the
  render pipeline via `OTEL_EXPORTER_OTLP_ENDPOINT` (OTLP/HTTP protobuf);
  nothing is loaded or sent without it.
- **Internal:** Release notes are now curated for users; Dependabot keeps
  `@types/node` on the Node 24 line.

## 0.1.1

- **Internal:** Code base restructuring and README improvements.

## 0.1.0

- **New:** First release — flight-path map overlay videos from DJI drone
  recordings at exactly the source frame rate and frame count, with telemetry
  from the `.SRT` sidecar or the embedded CAM-meta (DVTM) stream; `satellite`
  and `topo` map styles, batch processing, config file support, `--json`
  summaries and `out` as the default output directory.
