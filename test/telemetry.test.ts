import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadTelemetry } from '../src/telemetry.js';
import { SRT_SAMPLE, cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('loadTelemetry (SRT source)', () => {
  it('builds per-frame values from the sidecar', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    fs.writeFileSync(video, '');
    fs.writeFileSync(path.join(dir, 'clip.srt'), SRT_SAMPLE);

    const tel = await loadTelemetry(video, {
      frames: 3,
      fpsValue: 30,
      durationSec: 0.1,
    });

    expect(tel.source).toBe('srt');
    expect(tel.method).toBe('srt-cues');
    expect(tel.headingMode).toBe('cog'); // no yaw in SRT
    expect(tel.sampleCount).toBe(3);
    expect(tel.noLock).toBe(1);
    expect(tel.frames).toHaveLength(3);

    // First frame sits on the first fix.
    expect(tel.frames[0].lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].lon).toBeCloseTo(14.262388, 6);

    // Altitude is carried through (relative preferred).
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);

    // bbox covers both fixes; track distance is the ~0.15 m between them.
    expect(tel.bbox.minLat).toBeCloseTo(46.61307, 6);
    expect(tel.bbox.maxLat).toBeCloseTo(46.613071, 6);
    expect(tel.trackDistanceM).toBeGreaterThan(0);
    expect(tel.trackDistanceM).toBeLessThan(2);
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
      if (i >= 21 && i <= 40) lat += (i - 20) * 0.00001; // north
      if (i >= 41) {
        lat += 20 * 0.00001;
        lon += (i - 40) * 0.00001; // east
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
    fs.writeFileSync(path.join(dir, 'turn.srt'), turnSrt());

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
});
