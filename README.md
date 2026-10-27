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
# from GitHub
npx github:MrManny/neo2-flightpath "my-flight.mp4"

# from npm
npx neo2-flightpath "my-flight.mp4"

# topographic map, altitude + speed HUD
npx neo2-flightpath "my-flight.mp4" --style topo --hud heading,alt,speed
```

Output lands beside the source video as `<basename>_map.mp4` (configurable).

### Example output

All frames below are at **1:20** of the same recording, `DJI_20261010105301_0001_D.MP4`
(Hohenwurz, 2026-10-10):

![Source footage at 1:20: autumn meadows and forest above the Gurktal](docs/images/example-source-frame.jpg)

*Source footage at 1:20 — the flight recording the examples below are rendered from.*

![Default output at 1:20: satellite map with growing trail and heading arrow](docs/images/example-map-satellite.jpg)

*Default settings (first two commands): satellite map, growing trail and heading arrow.*

![Topographic output at 1:20 with heading, altitude and speed chips](docs/images/example-map-topo-hud.jpg)

*`--style topo --hud heading,alt,speed` (third command): topographic map with heading, altitude and speed chips.*

## Requirements

- **Node.js >= 24**
- **ffmpeg + ffprobe** on `PATH` (telemetry extraction and video encoding).
  Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`;
  Linux: `apt install ffmpeg`.
- **Google Chrome or Microsoft Edge** installed — rendering uses the system
  browser via `playwright-core`, which itself never downloads a browser. No
  system browser either? `npx playwright install chromium` works too (the
  Playwright browser registry is tried automatically), and any Chromium
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

## Examples

```sh
# quick conversion: one video, all default settings
neo2-flightpath "flight.mp4"

# full flight-path video: topographic map and the complete HUD
# (heading arrow + altitude + speed chips)
neo2-flightpath "flight.mp4" --style topo --hud heading,alt,speed
```

## Config file

Options can live in a `.neo2flightpath.json` discovered upward from the working
directory (or named explicitly with `--config`). Precedence: **CLI flags >
config file > defaults**. Keys are camelCase versions of the flags; a complete
example lives in [.neo2flightpath.example.json](.neo2flightpath.example.json):

```json
{
  "outDir": "out/flightmaps",
  "outSuffix": "_map",
  "width": 768,
  "height": 768,
  "style": "satellite",
  "view": "follow",
  "zoom": 0,
  "zoomOut": 1,
  "introSec": 2,
  "outroSec": 2,
  "hud": "heading,alt,speed",
  "workers": 4,
  "capture": "jpeg",
  "preset": "medium",
  "trail": "full",
  "tileCache": "out/tilecache",
  "browser": null,
  "skipExisting": false,
  "recurse": false,
  "json": false,
  "quiet": false
}
```

All keys are optional; anything omitted falls back to the default in the
option table above. `hud` uses the same comma syntax as `--hud`, `browser`
and an empty `outDir` (`null`) mean "system default" and "beside the source".

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

## Releasing

Releases are published to npm by GitHub Actions — never by hand:

1. Bump `version` in `package.json`, commit and push to `main`.
2. On GitHub, create a **release** whose tag matches the version
   (`v0.2.0`; the leading `v` is optional). Prerelease releases are skipped.
3. The [release workflow](.github/workflows/release.yml) verifies the tag
   against `package.json`, runs lint, tests and build, then publishes to npm
   with provenance. Verify on <https://www.npmjs.com/package/neo2-flightpath>.

Publishing authentication (one-time setup, in this order):

1. **Bootstrap** — the package does not exist on npm yet, and npm only allows
   configuring trusted publishing for existing packages. Create a *granular
   access token* on <https://www.npmjs.com/settings/>: permission
   **"Read and write (publish and stage)"**, packages: `neo2-flightpath` only,
   a short expiry (7 days is plenty) and tick **"Bypass two-factor
   authentication"** — a workflow cannot answer an OTP prompt. npm shows a
   security warning there; it is aimed at long-lived tokens, and this one
   lives only through the first release. Add it as the `NPM_TOKEN`
   **repository secret** on GitHub (Settings → Secrets and variables →
   Actions). Keep this token as your fallback until the trusted-publishing
   release below is green, then revoke it.
2. **Trusted publishing** — after the first release, open the package settings
   on npmjs.com → *Trusted publisher* → GitHub Actions:
   owner `MrManny`, repository `neo2-flightpath`, workflow filename
   `release.yml`, and tick **"Allow npm publish"** (new configurations default
   to stage-publish only).
3. **Switch over** — delete the `NPM_TOKEN` secret on GitHub *before* the next
   release (the workflow only uses OIDC while the secret is absent), then cut
   that release **within 2 days** — npm validates a new trusted publisher with
   its first publish and expires unvalidated configurations. Once that release
   is green, publishing is token-free.

## License

MIT — see [LICENSE](LICENSE).
