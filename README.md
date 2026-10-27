# neo2-flightpath

Render **flight-path map overlay videos** from DJI drone recordings (DJI Neo 2
and similar): a growing trail, a heading arrow and a live map, rendered at
**exactly the source frame rate and frame count** so the result drops 1:1 onto
the original footage in any video editor.

Telemetry comes from the recording's **`.SRT` sidecar** (DJI SubRip, one cue per
frame) or, when there is none, from the **embedded `CAM meta` stream** (DJI's
internal DVTM protobuf telemetry inside the MP4).

## Quick start

```sh
# from GitHub (this repo must be public, or you need GitHub access to it)
npx github:MrManny/neo2-flightpath "my-flight.mp4"

# once published to npm
npx neo2-flightpath "my-flight.mp4"

# a whole folder, topographic map, altitude + speed HUD
npx neo2-flightpath "./recordings" --style topo --hud heading,alt,speed
```

Output lands beside the source video as `<basename>_map.mp4` (configurable).

## Requirements

- **Node.js >= 24**
- **ffmpeg + ffprobe** on `PATH` (telemetry extraction and video encoding).
  Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`;
  Linux: `apt install ffmpeg`.
- **Google Chrome or Microsoft Edge** installed — rendering uses the system
  browser via `playwright-core`; nothing extra is downloaded. A custom
  executable can be forced with `--browser <path>`.
- Internet on the first run: map tiles are fetched politely and cached
  permanently afterwards (see *Tiles & attribution*).

## Usage

```
neo2-flightpath <inputs...> [options]
```

`<inputs...>` are `.mp4` files and/or folders (folders are scanned for `*.mp4`,
optionally with `--recurse`). Every recording is processed independently; a
failure never aborts the batch.

| Option | Default | Meaning |
|---|---|---|
| `--out-dir <dir>` | beside source | output folder |
| `--out-suffix <suffix>` | `_map` | output name = `<basename><suffix>.mp4` |
| `--width <px>` / `--height <px>` | `768` / `768` | canvas size (rounded down to even) |
| `--style <name>` | `satellite` | `satellite` (Esri World Imagery) or `topo` (OpenTopoMap) |
| `--view <mode>` | `follow` | `follow`: drone centered, map slides under it; `overview`: static whole-track map |
| `--zoom <n>` | `0` | fixed view zoom (`0` = auto-fit to the track) |
| `--zoom-out <n>` | `1` | auto-fit only: pull the camera back *n* zoom levels |
| `--intro-sec <s>` / `--outro-sec <s>` | `2` / `2` | smoothstep zoom-in intro / zoom-out outro |
| `--hud <list>` | `heading` | comma list of `heading`, `alt`, `speed` — or `none`; the `alt` chip hides automatically when the telemetry has no altitude |
| `--workers <n>` | `4` | parallel browser capture pages |
| `--capture <mode>` | `jpeg` | `jpeg` (q95 screenshots, ~5x faster) or `png`; `canvas` is parked |
| `--preset <name>` | `medium` | x264 preset (`medium` \| `veryfast`) |
| `--trail <mode>` | `full` | trail update strategy (`full` \| `incr`) |
| `--tile-cache <dir>` | per-user cache | tile cache directory |
| `--browser <path>` | system Chrome/Edge | browser executable |
| `--skip-existing` | off | skip recordings whose output exists and matches the source (frame count + frame rate) |
| `--recurse` | off | scan input folders recursively |
| `--json` | off | print one NDJSON summary line per recording on stdout (progress stays on stderr) |
| `--config <path>` | auto | config file (see below) |
| `-q, --quiet` | off | suppress progress output |

The heading arrow shows **drone yaw** when the `CAM meta` stream provides it
(valid even while hovering), otherwise **course over ground** computed from the
track.

## Config file

Options can live in a `.neo2flightpath.json` discovered upward from the working
directory (or named explicitly with `--config`). Precedence: **CLI flags >
config file > defaults**. Keys are camelCase versions of the flags:

```json
{
  "outDir": "_derived/flightmaps",
  "tileCache": "_derived/tilecache",
  "width": 768,
  "height": 768,
  "style": "satellite",
  "hud": "heading"
}
```

## Output & verification

Every render is verified after encoding: the output must have **exactly** the
source's frame count and frame rate, otherwise the recording is reported as
failed. With `--json`, one NDJSON summary line is written per recording on
stdout (status `ok`, `skipped` or `error`, plus frames, fps, telemetry source,
fix count, track distance, bbox, zoom and tile stats) — handy for scripting.

## Telemetry sources

- **`.SRT` sidecar** (preferred): same basename as the video, one cue per frame.
  Cues with `latitude: 0 … longitude: 0` mean *no GPS lock* and are skipped
  without losing frame alignment.
- **`CAM meta` / DVTM** (fallback): DJI's per-frame protobuf telemetry embedded
  in the MP4 `data` stream (`djmd` sample entry). Decoded field map:
  `GpsBasic{lat, lon, gps_altitude_mm}`, `RelativeAltitude` (mm),
  `AbsoluteAltitude` (m), `EulerAngle{pitch, roll, yaw}` (deci-degrees). If the
  firmware layout is unrecognized, a byte-scan fallback finds the GPS double
  pair. Layout knowledge was verified value-by-value against `.SRT` data;
  recovered schema references: [AdrianEddy/telemetry-parser](https://github.com/AdrianEddy/telemetry-parser)
  (MIT/Apache-2.0). There is no official DJI spec.

Recordings without any telemetry source are reported as failed with a clear
message; the batch continues.

## Tiles & attribution

- `satellite`: Esri World Imagery — attribution *Imagery © Esri, Maxar,
  Earthstar Geographics, and the GIS User Community* (Esri usage limits apply).
- `topo`: OpenTopoMap — attribution *© OpenStreetMap contributors, SRTM |
  Style: © OpenTopoMap (CC-BY-SA)*.

Attribution is rendered into every frame. Tiles are fetched at a polite rate
(~2.5 requests/s, custom `User-Agent`), cached permanently, and failed tiles
are retried on the next run. Do not mass-produce tiles against the public
endpoints.

## Development

```sh
npm install     # also builds via prepare
npm run build   # tsc -> dist/
npm test        # vitest unit tests
npm run lint    # eslint + typescript-eslint
```

Layout: `src/cli.ts` (commander interface) → `src/run.ts` (batch pipeline) →
`src/telemetry.ts` (SRT / CAM-meta unification) → `src/page.ts` +
`src/render.ts` (Leaflet page, headless capture, ffmpeg encode). Unit tests
live in `test/`, including synthetic DVTM protobuf fixtures for the CAM-meta
decoder.

CI (GitHub Actions) runs lint, tests, build and `npm pack --dry-run` on Node 24
and 26. Dependabot checks npm packages and Actions monthly. Dependency
versions are pinned with `~` (patch updates only).

## Publishing (checklist for the release session)

- [ ] npm name `neo2-flightpath` was free as of 2026-10-27 (names are only
      reserved at first publish)
- [ ] `npm login`, then `npm publish` (the `prepare` script builds `dist/`;
      `files` ships only `bin/`, `dist/`, README, LICENSE)
- [ ] verify: `npx neo2-flightpath --version`
- [ ] optional: make the GitHub repo public so `npx github:MrManny/neo2-flightpath`
      works without GitHub credentials

## License

MIT — see [LICENSE](LICENSE).
