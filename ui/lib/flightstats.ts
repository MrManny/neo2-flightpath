// Chip strings for the flight stats strip. The CLI summary prints raw
// telemetry identifiers; the chips show their plain names.

import type { FlightStats } from '../../src/appsession.js';
import { fixesLabel, noLockCuesLabel, trackDistanceLabel } from '../../src/summary.js';
import { formatTime } from './framedriver.js';

const SOURCE_LABELS: Record<string, string> = {
  srt: 'SRT',
  cammeta: 'Camera metadata',
};

const METHOD_LABELS: Record<string, string> = {
  'srt-cues': 'cues',
  'dvtm-packets': 'packets',
  'cammeta-scan': 'scan',
};

const HEADING_LABELS: Record<string, string> = {
  yaw: 'drone yaw',
  cog: 'course over ground',
};

function labelFor(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

export function formatStats(stats: FlightStats): string[] {
  const chips = [
    `Duration ${formatTime(stats.durationSec)}`,
    `Track ${trackDistanceLabel(stats.trackDistanceM)}`,
    `${labelFor(SOURCE_LABELS, stats.source)} (${labelFor(METHOD_LABELS, stats.method)})`,
    fixesLabel(stats.fixes),
  ];
  // The CLI summary only mentions no-lock cues when there are any.
  if (stats.noLock > 0) chips.push(noLockCuesLabel(stats.noLock));
  chips.push(`Heading: ${labelFor(HEADING_LABELS, stats.headingMode)}`);
  return chips;
}
