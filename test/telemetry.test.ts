import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadTelemetry } from '../src/telemetry.js';
import { SRT_SAMPLE } from './fixtures.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2tel-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

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
