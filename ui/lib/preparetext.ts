// The loading copy of the Open flow: the notice names the running preparation
// stage and counts the tiles during the map pre-warm (design guidelines §8.6).
import type { PrepareProgress } from '../../src/run.js';

export function prepareNoticeText(progress: PrepareProgress): string {
  switch (progress.stage) {
    case 'probe':
      return 'Probing the recording…';
    case 'telemetry':
      return 'Loading telemetry…';
    case 'plan':
      return 'Planning the view…';
    case 'tiles':
      return `Warming tiles… ${progress.tilesDone}/${progress.tilesTotal}`;
  }
}

export function preparePercent(progress: PrepareProgress): number {
  return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
}
