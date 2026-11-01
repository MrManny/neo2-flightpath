// The done-phase summary, pinned copy from the design guidelines §12:
// "{frames} frames @ {fps} · {seconds} s · {width}×{height}". Seconds are
// whole; width and height are the even sizes the export rendered. A summary
// without a frame rate drops the rate clause instead of leaving it blank.

import type { RecordingSummary } from '../../src/run.js';
import { formatFrameRate } from './framerate.js';

export function formatExportSummary(summary: RecordingSummary): string {
  const rate = summary.fps ? ` @ ${formatFrameRate(summary.fps)}` : '';
  return (
    `${summary.frames} frames${rate} · ${Math.round(summary.elapsedSec)} s · ` +
    `${summary.width}×${summary.height}`
  );
}
