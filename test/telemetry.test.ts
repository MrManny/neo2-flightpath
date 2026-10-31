import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { decodePacketSamples } from '../src/cammeta.js';
import type { PacketInfo } from '../src/cammeta.js';
import { parseSrtText } from '../src/srt.js';
import { loadTelemetry } from '../src/telemetry.js';
import {
  SRT_SAMPLE,
  SRT_SAMPLE_MIXED,
  cleanupTmpDirs,
  productMetaPacket,
  tmpDir,
  writeSrt,
} from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('loadTelemetry (SRT source)', () => {
  it('builds per-frame values from the sidecar', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, SRT_SAMPLE);

    const tel = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
    });

    expect(tel.source).toBe('srt');
    expect(tel.method).toBe('srt-cues');
    expect(tel.headingMode).toBe('cog'); // no yaw in SRT
    expect(tel.sampleCount).toBe(3);
    expect(tel.fixCount).toBe(2);
    expect(tel.noLock).toBe(1);
    expect(tel.frames).toHaveLength(3);

    // First frame sits on the first fix.
    expect(tel.frames[0].lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].lon).toBeCloseTo(14.262388, 6);

    // Carried through from the cue, rel_alt preferred over abs_alt.
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);

    // bbox covers both fixes; track distance is the ~0.15 m between them.
    expect(tel.bbox.minLat).toBeCloseTo(46.61307, 6);
    expect(tel.bbox.maxLat).toBeCloseTo(46.613071, 6);
    expect(tel.trackDistanceM).toBeGreaterThan(0);
    expect(tel.trackDistanceM).toBeLessThan(2);
  });

  it('counts fixes exactly when a cue has no lat/lon line at all', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, SRT_SAMPLE_MIXED);

    const tel = await loadTelemetry(video, {
      frames: 4,
      fpsValue: 30,
      durationSec: 0.133,
    });

    // 4 cues: 2 fixes, 1 no-lock, 1 without any lat/lon line - the last one
    // is neither, so sampleCount - noLock would overstate the fixes.
    expect(tel.sampleCount).toBe(4);
    expect(tel.noLock).toBe(1);
    expect(tel.fixCount).toBe(2);
  });

  it('rejects videos without any telemetry source', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'naked.mp4');
    fs.writeFileSync(video, '');
    await expect(
      loadTelemetry(video, { frames: 2, fpsValue: 30, durationSec: 1 }),
    ).rejects.toThrow(/no telemetry found/);
  });
});

describe('loadTelemetry (heading)', () => {
  // 25 fps cues (40 ms): hover, then fly north, then turn east. The leading
  // hover has no course over ground, so its heading must be back-filled from
  // the FIRST known heading (north) - not the flight's final one (east).
  function turnSrt(): string {
    const cues: string[] = [];
    for (let i = 0; i <= 70; i++) {
      const ms = i * 40;
      let lat = 46.613;
      let lon = 14.262;
      if (i >= 21 && i <= 40) lat += (i - 20) * 0.00001;
      if (i >= 41) {
        lat += 20 * 0.00001;
        lon += (i - 40) * 0.00001;
      }
      cues.push(
        `${i + 1}`,
        `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')} --> ` +
          `00:00:${String(Math.floor((ms + 40) / 1000)).padStart(2, '0')},${String((ms + 40) % 1000).padStart(3, '0')}`,
        '2026-05-25 09:18:11.708',
        `[latitude: ${lat.toFixed(6)}] [longitude: ${lon.toFixed(6)}]`,
        '[rel_alt: 3.300 abs_alt: 313.227]',
        '',
      );
    }
    return cues.join('\n');
  }

  it('back-fills leading headings from the first known heading', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'turn.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, turnSrt());

    const tel = await loadTelemetry(video, {
      frames: 71,
      fpsValue: 25,
      durationSec: 2.84,
    });

    expect(tel.headingMode).toBe('cog');
    // Frame 0 is still hovering: its heading must match the northbound leg.
    const first = tel.frames[0].headingDeg;
    expect(Math.min(first, 360 - first)).toBeLessThan(30);
    // The final frames face east - the turn is real and was detected.
    const last = tel.frames[70].headingDeg;
    expect(Math.abs(last - 90)).toBeLessThan(30);
  });

  // A slow eastbound crawl (~1 m/s): a fixed 0.7 s course baseline never
  // clears the jitter floor here, so earlier versions held one stale heading
  // for the whole flight. The baseline must widen instead.
  it('tracks course over ground on slow flights instead of holding one value', async () => {
    const cues: string[] = [];
    for (let i = 0; i <= 124; i++) {
      const ms = i * 40;
      const lon = 14.262 + i * 0.00000052;
      cues.push(
        `${i + 1}`,
        `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')} --> ` +
          `00:00:${String(Math.floor((ms + 40) / 1000)).padStart(2, '0')},${String((ms + 40) % 1000).padStart(3, '0')}`,
        '2026-05-25 09:18:11.708',
        `[latitude: 46.613000] [longitude: ${lon.toFixed(7)}]`,
        '[rel_alt: 3.300 abs_alt: 313.227]',
        '',
      );
    }
    const dir = tmpDir();
    const video = path.join(dir, 'slow.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, cues.join('\n'));

    const tel = await loadTelemetry(video, {
      frames: 125,
      fpsValue: 25,
      durationSec: 5,
    });

    expect(tel.headingMode).toBe('cog');
    for (const frame of [30, 60, 90, 120]) {
      expect(Math.abs(tel.frames[frame].headingDeg - 90)).toBeLessThan(25);
    }
  });
});

// The same coordinates must land on the same fixes/no-lock counts whether
// they arrive as SRT cues or as CAM meta packets: one rule (src/geo.ts's
// isGpsFix) judges both pipelines.
describe('cross-source fix classification', () => {
  function srtCueText(coords: Array<[number, number]>): string {
    return coords
      .map(([lat, lon], i) =>
        [
          `${i + 1}`,
          `00:00:00,${String(i * 33).padStart(3, '0')} --> ` +
            `00:00:00,${String(i * 33 + 33).padStart(3, '0')}`,
          `[latitude: ${lat}] [longitude: ${lon}]`,
        ].join('\n'),
      )
      .join('\n');
  }

  function srtCounts(coords: Array<[number, number]>): {
    fixes: number;
    noLock: number;
  } {
    const r = parseSrtText(srtCueText(coords));
    return { fixes: r.cues.filter((c) => c.lat !== null).length, noLock: r.noLock };
  }

  function camCounts(coords: Array<[number, number]>): {
    fixes: number;
    noLock: number;
  } {
    const parts = coords.map(([lat, lon]) => productMetaPacket(lat, lon));
    const packets: PacketInfo[] = [];
    let tSec = 0;
    for (const part of parts) {
      packets.push({ tSec, size: part.length });
      tSec += 1 / 30;
    }
    const { samples, noLock } = decodePacketSamples(
      Buffer.concat(parts),
      packets,
      false,
    );
    return { fixes: samples.length, noLock };
  }

  const CASES: Array<{
    name: string;
    coords: Array<[number, number]>;
    fixes: number;
    noLock: number;
  }> = [
    {
      name: 'regular fixes',
      coords: [[46.6, 14.3], [46.61, 14.31]],
      fixes: 2,
      noLock: 0,
    },
    {
      name: 'the 0/0 placeholder',
      coords: [[0, 0], [46.6, 14.3], [46.61, 14.31]],
      fixes: 2,
      noLock: 1,
    },
    {
      name: 'near-null-island fixes (the disagreement regression)',
      coords: [[0.1, 0.1], [0.5, 0.5], [46.6, 14.3]],
      fixes: 3,
      noLock: 0,
    },
    {
      name: 'equator and prime meridian crossings',
      coords: [[0.2, 10.2], [10.2, 0.2], [0, 0]],
      fixes: 2,
      noLock: 1,
    },
    {
      name: 'out-of-range coordinates',
      coords: [[91, 0], [0, 181], [46.6, 14.3]],
      fixes: 1,
      noLock: 2,
    },
    {
      name: 'mixed fixes, placeholders and boundaries',
      coords: [[0, 0], [0.1, 0.1], [0.5, 0.5], [0, 0], [46.6, 14.3], [46.61, 14.31]],
      fixes: 4,
      noLock: 2,
    },
  ];

  it.for(CASES)('$name: SRT and CAM meta agree', ({ coords, fixes, noLock }) => {
    expect(srtCounts(coords)).toEqual({ fixes, noLock });
    expect(camCounts(coords)).toEqual({ fixes, noLock });
  });

  it('counts near-null-island fixes through loadTelemetry', async () => {
    // End-to-end: the old 0.5-degree box dropped these cues and loadTelemetry
    // failed with fewer than 2 GPS fixes.
    const dir = tmpDir();
    const video = path.join(dir, 'coast.mp4');
    fs.writeFileSync(video, '');
    writeSrt(video, srtCueText([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]));

    const tel = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
    });
    expect(tel.fixCount).toBe(3);
    expect(tel.noLock).toBe(0);
  });
});
