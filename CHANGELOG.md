# neo2-flightpath

## 0.2.0

### Minor Changes

- a271d1b: Add opt-in OpenTelemetry trace export for the render pipeline (OTLP/HTTP protobuf); nothing is loaded or sent unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (#14).

### Patch Changes

- a271d1b: Add a `CHANGELOG.md` recording user-visible changes, with `npm run changeset` to add fragments and `npm run changeset:version` to fold them at release time; CI requires a fragment on `feat`/`fix` pull requests and a `CHANGELOG.md` update on `release` pull requests (#13).
- Keep Dependabot's `@types/node` updates within the Node 24 major (`>= 24 < 25`) so type-checking cannot drift past the oldest supported runtime.

## 0.1.1

### Patch Changes

- No functional changes in this release: internal restructuring (#7) and README improvements (#9).

## 0.1.0

### Minor Changes

- Initial release of `neo2-flightpath`: renders flight-path map overlay videos from DJI drone recordings at exactly the source frame rate and frame count, with telemetry from the `.SRT` sidecar or the embedded CAM-meta (DVTM) stream, `satellite` and `topo` map styles, batch processing, config file support and `--json` summaries (#4).
- The output directory now defaults to `out` when no configuration file sets `outDir` (#6).
