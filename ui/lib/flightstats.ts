// Chip strings for the flight stats strip, wording the CLI summary values so
// the two can be compared value for value.

import type { FlightStats } from '../../src/appsession.js';
import { fixesLabel, noLockCuesLabel, trackDistanceLabel } from '../../src/summary.js';
import { formatTime } from './framedriver.js';

export function formatStats(stats: FlightStats): string[] {
  const chips = [
    `Duration ${formatTime(stats.durationSec)}`,
    `Track ${trackDistanceLabel(stats.trackDistanceM)}`,
    `${stats.source} (${stats.method})`,
    fixesLabel(stats.fixes),
  ];
  // The CLI summary only mentions no-lock cues when there are any.
  if (stats.noLock > 0) chips.push(noLockCuesLabel(stats.noLock));
  chips.push(`heading: ${stats.headingMode}`);
  return chips;
}
