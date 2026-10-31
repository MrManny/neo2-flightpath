# neo2-flightpath

This handy little tool allows you to render flight-path map videos
from DJI drone recordings (DJI Neo 2 and similar).

I wanted a tool to render the actual flight-path on a 2d map,
so that I can overlay it in the actual footage of my drone flight
videos.

Currently, it supports two main ways to acquire the geo-coordinates from
DJI's telemetry:

- if an `.SRT` sidecar is available, that will be used,
- otherwise it tries to parse the embedded `CAM` meta stream (DJI's protobuf format).

It is a CLI tool, since I plan to support agentic use cases.
Meaning, if an agent wants to use it to help you create flight-path videos,
that's all cool with me.

For us humans, there is a desktop app (see *Desktop app*): it opens a window
where you pick a recording and watch its flight path on the map in sync with
the footage.

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

All frames below are from the same recording:

![Source footage at 1:20: autumn meadows and forest](docs/images/example-source-frame.jpg)

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

## Desktop app

For reviewing flights without the terminal, grab the packaged desktop app
(Windows portable or Linux AppImage) from
[GitHub Releases](https://github.com/MrManny/neo2-flightpath/releases), or run
`npm run build && npm run app` from a checkout. Launching it opens a window where
**Open…** picks a video through the native file dialog; the
screen then shows the footage and the map overlay (trail, heading arrow, HUD
chips) in a swappable picture-in-picture layout on one shared timeline
scrubber. Play, pause and scrub keep the video frame, trail, drone position
and HUD chips on the same frame; the map fills its pane at any window size,
while the export framing follows `--width` / `--height` as usual.

The **Settings** panel (opened from the control bar) mirrors the CLI option
vocabulary &mdash; map style, view, zoom/zoom-out, intro/outro seconds, HUD
chips &mdash; and every change restyles the preview instantly, without
reloading the recording; the `alt` chip hides
itself automatically when the telemetry has no altitude. A look change fetches
any missing map tiles on demand (politely, at two requests per second) into the
same cache the CLI uses.

- The app embeds Chromium and needs no system browser, but it does need
  **ffmpeg + ffprobe** on `PATH` like the CLI; map tiles need internet on the
  first run and are cached like CLI tiles.
- One recording at a time — batch rendering stays a CLI concern.

**Export…** (button in the control bar) renders the recording with the look you
see in the preview. Choose *Full recording* or the *In–Out segment* (set the
loop points with `I` / `O` first), set the output size, press **Start export**, and pick the file with
the native save dialog. Exports run one at a time and cannot be paused;
*Cancel export* stops the render and removes its working file. The video is written to
a working file and only replaces the chosen file once it has been verified, so
a failed or canceled export never touches an existing file. Closing the window
during an export asks whether to stop it.

## Usage

If you are stuck, `npx neo2-flightpath --help` can help.

```
neo2-flightpath <inputs...> [options]
```

`<inputs...>` are `.mp4` files and/or folders (folders are scanned for `*.mp4`,
optionally with `--recurse`). Every recording is processed independently.

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
| `--tile-cache <dir>` | per-user cache | tile cache directory |
| `--browser <path>` | system Chrome/Edge | browser executable |
| `--skip-existing` | off | skip recordings whose output exists and matches the source (frame count + frame rate) |
| `--recurse` | off | scan input folders recursively |
| `--json` | off | print one NDJSON summary line per recording on stdout (progress stays on stderr) |
| `--config <path>` | auto | config file (see below) |
| `-q, --quiet` | off | suppress progress output |

The heading arrow shows drone yaw when the `CAM meta` stream provides it
(valid even while hovering), otherwise the yaw is computed from the track.

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
directory (or named explicitly with `--config`). A complete example lives in
[.neo2flightpath.example.json](.neo2flightpath.example.json).

All keys are optional.
Anything omitted falls back to the default in the option table above.

## Tiles & attribution

- `satellite`: Esri World Imagery — attribution *Imagery © Esri, Maxar,
  Earthstar Geographics, and the GIS User Community* (Esri usage limits apply).
- `topo`: OpenTopoMap — attribution *© OpenStreetMap contributors, SRTM |
  Style: © OpenTopoMap (CC-BY-SA)*.

Attribution is rendered into every frame. Tiles are fetched at a polite rate
(~2.5 requests/s, custom `User-Agent`), cached permanently, and failed tiles
are retried on the next run.
Do not mass-produce tiles against the public endpoints.

## Feature requests

If you want or need specific features, feel free to open an issue in this
repository's issue tracker.
I plan to maintain this project for a good bit, and hopefully making it more
useful for people in the long run.

## License

MIT — see [LICENSE](LICENSE).
