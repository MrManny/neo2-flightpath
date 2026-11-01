import { describe, expect, it } from 'vitest';

import {
  fixesLabel,
  noLockCuesLabel,
  telemetrySummary,
  trackDistanceLabel,
} from '../src/summary.js';
import { statsTelemetry } from './fixtures.js';

describe('telemetrySummary', () => {
  it('maps the telemetry fields every summary surface reports', () => {
    expect(telemetrySummary(statsTelemetry())).toEqual({
      source: 'cammeta',
      method: 'dvtm-packets',
      headingMode: 'yaw',
      fixes: 590,
      noLock: 4,
      trackDistanceM: 567,
    });
  });

  it.for([
    { name: 'rounds half up', value: 12.5, want: 13 },
    { name: 'rounds down below half', value: 12.4, want: 12 },
    { name: 'zero distance', value: 0, want: 0 },
    { name: 'sub-meter distance', value: 0.6, want: 1 },
  ])('track distance $value -> $want m ($name)', ({ value, want }) => {
    expect(telemetrySummary(statsTelemetry({ trackDistanceM: value })).trackDistanceM).toBe(want);
  });

  it('keeps srt-sourced and cog-derived telemetry verbatim', () => {
    const summary = telemetrySummary(
      statsTelemetry({ source: 'srt', method: 'srt-cues', headingMode: 'cog', noLock: 0 }),
    );
    expect(summary.source).toBe('srt');
    expect(summary.method).toBe('srt-cues');
    expect(summary.headingMode).toBe('cog');
    expect(summary.noLock).toBe(0);
  });
});

describe('summary labels', () => {
  it.for([
    { name: 'fixes', label: fixesLabel(590), want: '590 fixes' },
    { name: 'fixes without any fix', label: fixesLabel(0), want: '0 fixes' },
    { name: 'no-lock cues', label: noLockCuesLabel(4), want: '4 no-lock cues' },
    { name: 'track distance', label: trackDistanceLabel(567), want: '567 m' },
    { name: 'zero track distance', label: trackDistanceLabel(0), want: '0 m' },
  ])('$name renders as $want', ({ label, want }) => {
    expect(label).toBe(want);
  });
});
