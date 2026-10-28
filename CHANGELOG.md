# neo2-flightpath

## 0.1.1

### Patch Changes

- No user-visible changes: internal restructuring (#7) and documentation improvements (#9).

## 0.1.0

### Minor Changes

- Initial release of `neo2-flightpath`: renders flight-path map overlay videos from DJI drone recordings at exactly the source frame rate and frame count, with telemetry from the `.SRT` sidecar or the embedded CAM-meta (DVTM) stream, `satellite` and `topo` map styles, batch processing, config file support and `--json` summaries (#4).
- The output directory now defaults to `out` when no configuration file sets `outDir` (#6).
