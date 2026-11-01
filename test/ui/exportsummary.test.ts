import { describe, expect, it } from 'vitest';

import type { RecordingSummary } from '../../src/run.js';
import { formatExportSummary } from '../../ui/lib/exportsummary.js';

function summary(overrides: Partial<RecordingSummary> = {}): RecordingSummary {
  return {
    video: '/recordings/flight.mp4',
    out: '/exports/flight-map.mp4',
    status: 'ok',
    elapsedSec: 4,
    frames: 120,
    fps: '30000/1001',
    width: 1280,
    height: 720,
    ...overrides,
  };
}

describe('formatExportSummary', () => {
  it('reads the rate in decimal fps', () => {
    expect(formatExportSummary(summary())).toBe('120 frames @ 29.97 fps · 4 s · 1280×720');
  });

  it('keeps a whole rate as whole fps', () => {
    expect(formatExportSummary(summary({ fps: '30' }))).toBe('120 frames @ 30 fps · 4 s · 1280×720');
  });

  it('rounds the elapsed seconds to whole ones', () => {
    expect(formatExportSummary(summary({ elapsedSec: 4.25 }))).toBe(
      '120 frames @ 29.97 fps · 4 s · 1280×720',
    );
  });

  it('shows the even rendered sizes, not the typed ones', () => {
    expect(formatExportSummary(summary({ width: 1278, height: 718 }))).toBe(
      '120 frames @ 29.97 fps · 4 s · 1278×718',
    );
  });

  it('drops the rate clause when the summary carries no rate', () => {
    expect(formatExportSummary(summary({ fps: undefined }))).toBe('120 frames · 4 s · 1280×720');
  });

  it('drops the rate clause when the rate is an empty string', () => {
    expect(formatExportSummary(summary({ fps: '' }))).toBe('120 frames · 4 s · 1280×720');
  });
});
