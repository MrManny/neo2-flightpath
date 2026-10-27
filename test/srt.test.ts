import { describe, expect, it } from 'vitest';

import { parseSrtText } from '../src/srt.js';
import { SRT_SAMPLE } from './fixtures.js';

describe('parseSrtText', () => {
  const r = parseSrtText(SRT_SAMPLE);

  it('keeps one cue per frame, including no-lock cues', () => {
    expect(r.count).toBe(3);
    expect(r.noLock).toBe(1);
  });

  it('parses GPS, altitude and wall clock of the first cue', () => {
    const c = r.cues[0];
    expect(c.lat).toBeCloseTo(46.61307, 6);
    expect(c.lon).toBeCloseTo(14.262388, 6);
    expect(c.relAlt).toBeCloseTo(3.3, 6);
    expect(c.absAlt).toBeCloseTo(313.227, 6);
    expect(c.wallMs).not.toBeNull();
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
});
