import { describe, expect, it } from 'vitest';

import { parseSrtText } from '../src/srt.js';
import { SRT_SAMPLE } from './fixtures.js';

describe('parseSrtText', () => {
  const r = parseSrtText(SRT_SAMPLE);

  it('keeps one cue per frame, including no-lock cues', () => {
    expect(r.count).toBe(3);
    expect(r.noLock).toBe(1);
  });

  it('parses GPS and altitude of the first cue', () => {
    const c = r.cues[0];
    expect(c.lat).toBeCloseTo(46.61307, 6);
    expect(c.lon).toBeCloseTo(14.262388, 6);
    expect(c.relAlt).toBeCloseTo(3.3, 6);
    expect(c.absAlt).toBeCloseTo(313.227, 6);
    expect(c.tSec).toBe(0);
  });

  it('marks 0/0 coordinates as no-lock with null lat/lon', () => {
    const c = r.cues[1];
    expect(c.lat).toBeNull();
    expect(c.lon).toBeNull();
    expect(c.relAlt).toBeCloseTo(3.4, 6);
    expect(c.tSec).toBeCloseTo(0.033, 6);
  });

  it('computes cue times relative to the first cue', () => {
    expect(r.cues[2].tSec).toBeCloseTo(0.066, 6);
    expect(r.cues[2].lat).toBeCloseTo(46.613071, 6);
  });

  it('strips font tags before matching', () => {
    // Every cue line is wrapped in <font ...> in real files; parsing must not
    // fail on them - already proven by the fixture, asserted explicitly here.
    expect(parseSrtText('<font size="28">[latitude: 1.0] [longitude: 2.0]</font>').count).toBe(0);
  });

  it('counts a repeated lat/lon line in one cue as a single no-lock event', () => {
    const text = [
      '1',
      '00:00:00,000 --> 00:00:00,033',
      '2026-05-25 09:18:11.708',
      '[latitude: 0] [longitude: 0]',
      '[latitude: 0] [longitude: 0]',
      '[rel_alt: 1.000 abs_alt: 300.000]',
    ].join('\n');
    const r = parseSrtText(text);
    expect(r.count).toBe(1);
    expect(r.noLock).toBe(1);
  });
});

function cueText(lat: number, lon: number): string {
  return [
    '1',
    '00:00:00,000 --> 00:00:00,033',
    `[latitude: ${lat}] [longitude: ${lon}]`,
  ].join('\n');
}

// One documented rule (src/geo.ts's isGpsFix) decides what counts as a fix;
// anything else on a lat/lon line is one no-lock event.
describe('cue fix classification', () => {
  it.for([
    { name: 'regular fix', lat: 46.61307, lon: 14.262388, fix: true },
    { name: 'prime meridian crossing', lat: 10.2, lon: 0.2, fix: true },
    { name: 'equator crossing', lat: 0.2, lon: 10.2, fix: true },
    {
      name: 'near-null-island fix (the disagreement regression)',
      lat: 0.1,
      lon: 0.1,
      fix: true,
    },
    { name: 'the 0.5 boundary', lat: 0.5, lon: 0.5, fix: true },
    { name: 'the 0/0 placeholder', lat: 0, lon: 0, fix: false },
    { name: 'out-of-range latitude', lat: 91, lon: 0, fix: false },
    { name: 'out-of-range longitude', lat: 0, lon: 181, fix: false },
  ])('$name -> fix:$fix', ({ lat, lon, fix }) => {
    const r = parseSrtText(cueText(lat, lon));
    expect(r.noLock).toBe(fix ? 0 : 1);
    expect(r.cues[0].lat !== null).toBe(fix);
  });
});
