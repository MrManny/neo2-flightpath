import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import { buildSceneData } from '../src/page.js';
import { prepareSession, recordingPageOpts } from '../src/run.js';
import type { PipelineDeps } from '../src/run.js';
import { restyleSceneData } from '../src/restyle.js';
import type { RestyleMeta } from '../src/restyle.js';
import type { VideoProbe } from '../src/ff.js';
import type { Telemetry } from '../src/telemetry.js';

const VIDEO = path.join('clips', 'flight.mp4');

const PROBE: VideoProbe = {
  fps: { num: 30, den: 1, value: 30, str: '30' },
  frames: 5,
  durationSec: 5 / 30,
  width: 1280,
  height: 720,
};

// The fix bbox is deliberately wider than the frame samples (a fix between
// two frame times never appears in a frame position): planning from the frame
// samples would fit the view tighter than the pipeline does.
function telemetryFixture(): Telemetry {
  return {
    source: 'srt',
    method: 'srt-cues',
    headingMode: 'cog',
    sampleCount: 3,
    fixCount: 3,
    noLock: 0,
    frames: [
      { lat: 46.61, lon: 14.26, alt: 10, speed: 1.2, headingDeg: 90 },
      { lat: 46.6105, lon: 14.2605, alt: 11, speed: 1.3, headingDeg: 91 },
      { lat: 46.611, lon: 14.261, alt: 12, speed: 1.4, headingDeg: 92 },
      { lat: 46.6115, lon: 14.2615, alt: 13, speed: 1.5, headingDeg: 93 },
      { lat: 46.612, lon: 14.262, alt: 14, speed: 1.6, headingDeg: 94 },
    ],
    bbox: { minLat: 46.605, maxLat: 46.615, minLon: 14.255, maxLon: 14.265 },
    trackDistanceM: 42,
  };
}

function stubDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    probeVideo: async () => PROBE,
    loadTelemetry: async () => telemetryFixture(),
    prefetchTiles: async () => ({ downloaded: 2, failed: 1, total: 5 }),
    renderVideo: async () => ({ profile: { evalMs: 10, captureMs: 20, emitMs: 30 } }),
    verifyOutput: async () => ({ frames: 5, fps: '30', ok: true }),
    outputMatchesSource: async () => false,
    ...overrides,
  };
}

function testConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

async function pipelineScene(config: RenderConfig) {
  const prep = await prepareSession(VIDEO, config, () => {}, {
    deps: stubDeps(),
  });
  const meta: RestyleMeta = {
    fps: prep.probe.fps.value,
    frames: prep.probe.frames,
    tileBase: '/tiles',
    bbox: prep.tel.bbox,
  };
  return { prep, meta, scene: buildSceneData(recordingPageOpts(prep, config), '/tiles') };
}

describe('restyleSceneData', () => {
  it('is the identity on the pipeline scene for unchanged settings', async () => {
    const config = testConfig();
    const { prep, meta, scene } = await pipelineScene(config);

    const next = restyleSceneData(scene, config, meta);

    expect(next).toEqual(scene);
    // Same planned zoom: the trail arrays keep their identity so the scene
    // knows no trail work is needed.
    expect(next.zoom).toBe(prep.overview.zoom);
    expect(next.trailLat).toBe(scene.trailLat);
  });

  it('plans from the telemetry fix bbox like the pipeline, not the frame samples', async () => {
    const config = testConfig();
    const { prep, meta, scene } = await pipelineScene(config);

    const fromFixes = restyleSceneData(scene, config, meta);
    // What planning from the frame samples alone would see (they span less
    // than the fixes).
    const fromFrames = restyleSceneData(scene, config, {
      ...meta,
      bbox: { minLat: 46.61, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
    });

    expect(fromFixes.zoom).toBe(prep.overview.zoom);
    expect(fromFixes.center).toEqual(scene.center);
    // The fixture discriminates: frame-sample planning would fit tighter.
    expect(fromFrames.zoom).not.toBe(prep.overview.zoom);
  });

  it('maps settings changes onto the scene vocabulary', async () => {
    const config = testConfig();
    const { meta, scene } = await pipelineScene(config);

    const topo = restyleSceneData(scene, testConfig({ style: 'topo' }), meta);
    expect(topo.tileUrl).toBe('/tiles/topo/{z}/{x}/{y}.png');
    expect(topo.attribution).toContain('OpenTopoMap');

    const fixed = restyleSceneData(
      scene,
      testConfig({ zoom: 13, zoomOut: 4 }),
      meta,
    );
    expect(fixed.zoom).toBe(13); // fixed zoom wins, zoom-out is ignored

    const overview = restyleSceneData(scene, testConfig({ view: 'overview' }), meta);
    expect(overview.view).toBe('overview');
  });

  it('re-decimates the trail only when the planned zoom changes', async () => {
    const config = testConfig();
    const { meta, scene } = await pipelineScene(config);

    const zoomed = restyleSceneData(scene, testConfig({ zoom: 12 }), meta);
    expect(zoomed.zoom).toBe(12);
    expect(zoomed.trailLat).not.toBe(scene.trailLat);

    const hudOnly = restyleSceneData(scene, testConfig({ introSec: 0 }), meta);
    expect(hudOnly.trailLat).toBe(scene.trailLat);
  });

  it('clamps intro and outro like the pipeline for short clips', async () => {
    const config = testConfig({ introSec: 2, outroSec: 2 });
    const { meta, scene } = await pipelineScene(config);

    const next = restyleSceneData(scene, config, meta);

    expect(next.introN).toBeGreaterThan(0);
    expect(next.introN + next.outroN).toBeLessThanOrEqual(Math.floor(PROBE.frames / 2));
  });

  it('hides the alt chip when the telemetry has no altitude', async () => {
    const config = testConfig({ hud: { heading: true, alt: true, speed: true } });
    const { meta } = await pipelineScene(config);
    const noAlt = stubDeps({
      loadTelemetry: async () => ({
        ...telemetryFixture(),
        frames: telemetryFixture().frames.map((f) => ({ ...f, alt: null })),
      }),
    });
    const prep = await prepareSession(VIDEO, config, () => {}, { deps: noAlt });
    const prepared = buildSceneData(recordingPageOpts(prep, config), '/tiles');

    const next = restyleSceneData(prepared, config, meta);

    expect(next.hud.alt).toBe(false);
    expect(next.hud.speed).toBe(true);
  });
});
