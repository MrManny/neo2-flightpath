import { describe, expect, it } from 'vitest';

import type { FlightStats } from '../../src/appsession.js';
import { formatStats } from '../../ui/lib/flightstats.js';

const STATS: FlightStats = {
  source: 'cammeta',
  method: 'ffprobe',
  headingMode: 'yaw',
  fixes: 1234,
  noLock: 8,
  trackDistanceM: 567,
  durationSec: 3,
};

describe('formatStats', () => {
  it('renders a chip per CLI summary value', () => {
    expect(formatStats(STATS)).toEqual([
      'Duration 0:03',
      'Track 567 m',
      'cammeta (ffprobe)',
      '1234 fixes',
      '8 no-lock cues',
      'heading: yaw',
    ]);
  });

  it('omits the no-lock chip when the CLI summary would print none', () => {
    expect(formatStats({ ...STATS, noLock: 0 })).toEqual([
      'Duration 0:03',
      'Track 567 m',
      'cammeta (ffprobe)',
      '1234 fixes',
      'heading: yaw',
    ]);
  });

  it.for([
    { name: 'long duration keeps minute totals', durationSec: 125.4, want: 'Duration 2:05' },
    { name: 'hour-long flight shows total minutes', durationSec: 3700, want: 'Duration 61:40' },
    { name: 'zero duration', durationSec: 0, want: 'Duration 0:00' },
    { name: 'sub-second duration rounds down', durationSec: 0.4, want: 'Duration 0:00' },
  ])('$name', ({ durationSec, want }) => {
    expect(formatStats({ ...STATS, durationSec })[0]).toBe(want);
  });

  it('shows the cog heading mode', () => {
    expect(formatStats({ ...STATS, headingMode: 'cog' })).toContain('heading: cog');
  });

  it('keeps srt-sourced telemetry readable', () => {
    expect(formatStats({ ...STATS, source: 'srt', method: 'sidecar' })).toContain('srt (sidecar)');
  });
});
