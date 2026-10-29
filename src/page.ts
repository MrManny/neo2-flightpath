// The generated page receives all telemetry inline (no fetch) and exposes
// window.__setFrame(i) for per-frame marker/trail updates. Headless capture
// workers and the app's interactive driver both call that one function; it
// resolves after the canvas has painted so screenshots are frame-exact. The
// map scene itself lives in src/renderer/ - one shared implementation with the
// app's React map island - and this module wires it into the page and carries
// the app chrome (video pane, scrubber, swappable picture-in-picture layout).
//
// Views:
//   overview - static map fitted to the whole track (trail grows with time)
//   follow   - drone marker stays in the frame center and the map slides under
//              it (all tiles are loaded once up-front; the per-frame move is a
//              pure CSS transform, so no tile loads happen mid-render)

import type { HudSpec, Style, View } from './config.js';
import type { DecimatedTrack } from './decimate.js';
import type { LatLon } from './geo.js';
import type { SceneData } from './renderer/scene.js';
import { TILE_SOURCES } from './tilesources.js';

export interface PageVideo {
  /** Media URL the <video> element loads, e.g. "/video". */
  src: string;
  /** Frames per second as a number; seeks snap to i / fps. */
  fps: number;
  frames: number;
  /** Source dimensions; the picture-in-picture box matches this aspect. */
  width: number;
  height: number;
}

export interface PageOpts {
  width: number;
  height: number;
  style: Style;
  view: View;
  center: LatLon;
  zoom: number;
  attribution: string;
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
  hud: HudSpec;
  decimated: DecimatedTrack;
  introN?: number;
  outroN?: number;
  video?: PageVideo;
}

// App chrome around the renderer: a stage with a main and a picture-in-picture
// slot (the map fills whichever slot holds it; the PiP box adopts the video's
// aspect so footage shows without borders) plus a control bar.
function uiCss(): string {
  return `
  body.ui { background: #0e131c; }
  #stage { position: absolute; left: 0; top: 0; right: 0; bottom: 64px; overflow: hidden; }
  #slot-main { position: absolute; inset: 0; }
  #slot-pip {
    position: absolute; right: 12px; bottom: 12px; width: 30%;
    aspect-ratio: 16 / 9;
    overflow: hidden; border-radius: 10px; background: #000; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.30);
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
  }
  #video {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; background: #000; display: block;
  }
  #controls {
    position: absolute; left: 0; right: 0; bottom: 0; height: 64px;
    display: flex; align-items: center; gap: 12px; padding: 0 16px;
    box-sizing: border-box; background: rgba(14,19,28,0.94); color: #ffffff;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #controls button {
    background: rgba(255,255,255,0.12); color: #ffffff;
    border: 1px solid rgba(255,255,255,0.25); border-radius: 8px;
    padding: 8px 14px; font-size: 14px; cursor: pointer; white-space: nowrap;
  }
  #controls button:disabled { opacity: 0.55; cursor: default; }
  #scrub { flex: 1; accent-color: #41f0ff; }
  #time, #fps {
    font-size: 13px; font-variant-numeric: tabular-nums;
    color: rgba(255,255,255,0.85); white-space: nowrap;
  }`;
}

// Shared pick-and-reload flow for the landing page and the app controls.
export function pickFlowScript(buttonId: string, statusId: string | null): string {
  const status = statusId === null ? null : `document.getElementById('${statusId}')`;
  const report = (msg: string): string =>
    status ? `          status.textContent = ${msg};` : `          window.alert(${msg});`;
  return `  (function () {
    var btn = document.getElementById('${buttonId}');
${status ? `    var status = ${status};` : ''}
    btn.addEventListener('click', function () {
      btn.disabled = true;
${status ? "      status.textContent = 'Preparing the recording (telemetry and map tiles)…';" : ''}
      fetch('/api/pick', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { window.location.reload(); return; }
          btn.disabled = false;
${report("j.canceled ? 'No recording picked.' : ('Could not open the recording: ' + j.error)")}
        })
        .catch(function (e) {
          btn.disabled = false;
${report("'Could not reach the app backend: ' + e")}
        });
    });
  })();`;
}

// Interactive driver: frame index is the single source of truth. Every
// explicit seek snaps the video to i / fps; during playback the index is
// derived from the frame the video actually presents (never clocked
// separately), so video and map cannot drift apart.
function videoDriverScript(): string {
  return `(function () {
  var D = window.__DATA;
  if (!D.video) return;
  var V = D.video;
  var mapIsMain = false;
  var mapFrame = document.getElementById('map-frame');
  var videoEl = document.getElementById('video');
  var slotMain = document.getElementById('slot-main');
  var slotPip = document.getElementById('slot-pip');
  var scrub = document.getElementById('scrub');
  var timeEl = document.getElementById('time');
  var fpsEl = document.getElementById('fps');
  var playBtn = document.getElementById('btn-play');
  var shownIdx = -1;
  var pendingScrub = null;
  var lastFpsT = 0;
  var fpsAcc = 0;
  var fpsCount = 0;
  var fpsShownAt = 0;

  scrub.max = String(Math.max(0, V.frames - 1));

  function setLayout(mainIsMap) {
    mapIsMain = mainIsMap;
    var pipHoldsVideo = mapIsMain;
    if (mapIsMain) {
      slotMain.appendChild(mapFrame);
      slotPip.appendChild(videoEl);
    } else {
      slotMain.appendChild(videoEl);
      slotPip.appendChild(mapFrame);
    }
    // The PiP box adopts the video's aspect so footage shows without bars
    // and without cropping; the map fills whatever box holds it. Portrait
    // (9:16) footage binds the box by height so it stays compact.
    if (pipHoldsVideo && V.width > 0 && V.height > 0) {
      var portrait = V.height > V.width;
      slotPip.style.aspectRatio = V.width + ' / ' + V.height;
      slotPip.style.width = portrait ? 'auto' : '30%';
      slotPip.style.height = portrait ? '45%' : 'auto';
    } else {
      slotPip.style.aspectRatio = '16 / 9';
      slotPip.style.width = '30%';
      slotPip.style.height = 'auto';
    }
    window.__relayout();
  }

  function fmt(sec) {
    var total = Math.max(0, Math.round(sec));
    return Math.floor(total / 60) + ':' + ('0' + (total % 60)).slice(-2);
  }

  function applyFrame(i) {
    if (i === shownIdx) return;
    shownIdx = i;
    window.__setFrame(i);
    scrub.value = String(i);
    timeEl.textContent = fmt(i / V.fps) + ' / ' + fmt((V.frames - 1) / V.fps);
  }

  // The frame the browser actually presents is the truth: its mediaTime maps
  // to the frame index via floor (round would make the map lead the footage
  // by half a frame). One callback per presented frame, chained.
  var usePresented = typeof videoEl.requestVideoFrameCallback === 'function';
  function onPresentedFrame(now, meta) {
    applyFrame(Math.max(0, Math.min(V.frames - 1, Math.floor(meta.mediaTime * V.fps + 1e-6))));
    videoEl.requestVideoFrameCallback(onPresentedFrame);
  }
  if (usePresented) videoEl.requestVideoFrameCallback(onPresentedFrame);

  playBtn.addEventListener('click', function () {
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  });
  videoEl.addEventListener('play', function () { playBtn.textContent = 'Pause'; });
  videoEl.addEventListener('pause', function () { playBtn.textContent = 'Play'; });
  videoEl.addEventListener('ended', function () { playBtn.textContent = 'Play'; });
  scrub.addEventListener('input', function () {
    pendingScrub = Number(scrub.value);
  });
  document.getElementById('btn-swap').addEventListener('click', function () {
    setLayout(!mapIsMain);
  });
  slotPip.addEventListener('click', function () {
    setLayout(!mapIsMain);
  });
${pickFlowScript('btn-open', null)}
  window.addEventListener('resize', function () { window.__relayout(); });

  function loop(now) {
    requestAnimationFrame(loop);
    if (pendingScrub !== null) {
      var seekTo = pendingScrub;
      pendingScrub = null;
      videoEl.currentTime = seekTo / V.fps;
      applyFrame(seekTo);
    } else if (!usePresented && !videoEl.paused && !videoEl.ended) {
      // Fallback clock when requestVideoFrameCallback is unavailable; only
      // while playing, so a paused scrub target is never re-derived into a
      // neighboring frame.
      var i = Math.floor(videoEl.currentTime * V.fps + 1e-6);
      applyFrame(Math.max(0, Math.min(V.frames - 1, i)));
    }
    if (lastFpsT > 0) {
      fpsAcc += now - lastFpsT;
      fpsCount++;
    }
    lastFpsT = now;
    if (fpsCount >= 20 && now - fpsShownAt > 500) {
      fpsEl.textContent = (1000 / (fpsAcc / fpsCount)).toFixed(0) + ' fps';
      fpsAcc = 0;
      fpsCount = 0;
      fpsShownAt = now;
    }
  }

  setLayout(false);
  applyFrame(0);
  var readyWait = setInterval(function () {
    if (window.__READY === true) {
      clearInterval(readyWait);
      playBtn.disabled = false;
      playBtn.textContent = 'Play';
    }
  }, 200);
  requestAnimationFrame(loop);
})();`;
}

// The module boot: it instantiates the shared scene and bridges the globals
// the headless capture and the interactive driver use. Runs after the DOM is
// parsed (module semantics), so the scene always finds its host element.
function bootScript(dataJson: string, interactive: boolean): string {
  return `import { createScene } from '/renderer/scene.js';
var D = window.__DATA = ${dataJson};
var scene = createScene(document.getElementById('scene-host'), D, { L: window.L });
window.__setFrame = function (i) { return scene.setFrame(i); };
window.__relayout = function () { scene.relayout(); };
scene.ready.then(function () { window.__READY = true; });${interactive ? `
${videoDriverScript()}` : ''}`;
}

export function buildPageHtml(opts: PageOpts): string {
  const {
    width, height, style, view, center, zoom, attribution,
    lat, lon, alt, speed, headingDeg, hud, decimated,
    introN = 0, outroN = 0, video,
  } = opts;

  const data: SceneData & { video: PageVideo | null } = {
    style,
    tileUrl: '/tiles/' + style + '/{z}/{x}/{y}.png',
    view,
    width,
    height,
    zoom,
    center: { lat: center.lat, lon: center.lon },
    attribution,
    introN,
    outroN,
    lat, lon, alt, speed, headingDeg,
    hud,
    trailLat: decimated.lat,
    trailLon: decimated.lon,
    trailFrame: decimated.frame,
    video: video ?? null,
  };
  // "</" must not appear verbatim: the JSON is inlined into a <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const head = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${video ? 'neo2-flightpath' : 'flight map'}</title>
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${TILE_SOURCES[style].bg}; }
</style>${video ? `
<style>${uiCss()}
</style>` : ''}
</head>`;

  const scripts = `<script src="/leaflet/leaflet.js"></script>
<script type="module">
${bootScript(json, video !== undefined)}
</script>`;

  if (!video) {
    return `${head}
<body>
<div id="scene-host"></div>
${scripts}
</body>
</html>`;
  }

  return `${head}
<body class="ui">
<div id="stage">
  <div id="slot-main"><video id="video" src="${video.src}" preload="auto" playsinline></video></div>
  <div id="slot-pip" title="Click to swap">
    <div id="scene-host"></div>
  </div>
</div>
<div id="controls">
  <button id="btn-play" disabled>Warming tiles…</button>
  <button id="btn-open">Open recording…</button>
  <input id="scrub" type="range" min="0" max="0" step="1" value="0">
  <span id="time">0:00 / 0:00</span>
  <span id="fps"></span>
  <span style="flex: 1"></span>
  <button id="btn-swap">Swap view</button>
</div>
${scripts}
</body>
</html>`;
}
