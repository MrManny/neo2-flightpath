import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadTelemetry } from '../src/telemetry.js';
import { SRT_SAMPLE, SRT_SAMPLE_MIXED, cleanupTmpDirs, tmpDir, writeSrt } from './fixtures.js';

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
