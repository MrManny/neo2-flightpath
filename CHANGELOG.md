# neo2-flightpath

## 0.3.0

- **New:** The desktop app — pick a recording and watch its flight path on a
  map in sync with the footage, one shared timeline scrubber and a swappable
  picture-in-picture layout. It ships as a Windows portable executable and a
  Linux AppImage, with its own application icon and the window title
  "Neo2 Flightpath".
- **New:** Export the look you see: a modal renders the preview as a video,
  the full recording or the In–Out loop segment at a chosen size, written
  through a native save dialog. Exports run as one cancelable job and are
  verified before they replace the chosen file, so a failed or canceled
  export never touches an existing file; "Reveal in folder" and "Open video"
  act on the exported file, and a refused cancel explains itself.
- **New:** Playback and review: speed 1x–4x, a loop region with I/O points
  that auto-engage and wrap on repeat (Esc or Clear to remove), and keyboard
  shortcuts for play/pause, speed, frame stepping, one-second jumps and
  swapping the views. Seeking is frame-exact: End reaches the last frame and
  every step lands exactly where requested.
- **New:** A settings panel (cog button): map style, view, zoom/zoom-out,
  intro/outro seconds and HUD chips mirror the CLI options and restyle the
  preview instantly, fetching any missing map tiles on demand. The alt chip
  hides itself when the telemetry has no altitude.
- **New:** Preparation progress on the landing card: a bar that advances one
  step per preparation stage and per warmed map tile, and the status notice
  names the running stage.
- **New:** Errors and progress read as plain sentences with the original
  system text under "Technical details", and the control bar fits the
  1024×600 minimum window.
- **New:** The map trail is drawn with one incremental update in the app and
  the CLI alike; the `--trail` option is removed — drop the `trail` key from
  config files.
- **Fixed:** One rule now counts GPS fixes in every telemetry source: exactly
  (0, 0) is the no-lock placeholder, so near-equator and near-prime-meridian
  coordinates count as fixes again, and fix counts agree between the SRT
  sidecar and camera metadata. Frames after the last GPS fix hold that fix
  instead of jumping back to the flight's start.
- **Fixed:** ffmpeg/ffprobe failures surface their real cause instead of a
  false "no telemetry found", mistyped numbers in config files fail fast
  naming the option instead of being silently coerced, and odd canvas
  dimensions normalize to even.
- **Fixed:** On Windows, output names differing only in case are one file —
  collision suffixing and the overwrite guard agree on it (on Linux and macOS
  they stay two distinct names).
- **Internal:** The app and the headless CLI share one map renderer, and CLI
  output stays frame-exact. Option defaults live in one table, the
  `--out-dir` default is documented as the `out` folder, CLI help names the
  offending flag, and the agent helpers move project statuses past the first
  result page.

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
