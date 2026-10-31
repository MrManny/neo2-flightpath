// The Open flow. "picking" covers the native dialog, so nothing is shown yet;
// "preparing" starts only when the backend reports a file that passed its
// checks, and carries the pipeline's loading progress.
import type { PrepareProgress } from '../../src/run.js';

// Mirrors prepareSession's first report, before any stage has finished.
export const START_PREPARE_PROGRESS: PrepareProgress = {
  stage: 'probe',
  done: 0,
  total: 3,
  tilesDone: 0,
  tilesTotal: 0,
};

export type PickState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'preparing'; progress: PrepareProgress }
  | { kind: 'ready' }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

export type PickEvent =
  | { type: 'pick' }
  | { type: 'preparing' }
  | { type: 'progress'; progress: PrepareProgress }
  | { type: 'picked' }
  | { type: 'canceled' }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' };

export function pickReducer(state: PickState, event: PickEvent): PickState {
  switch (event.type) {
    case 'pick':
      return state.kind === 'picking' || state.kind === 'preparing' ? state : { kind: 'picking' };
    case 'preparing':
      return state.kind === 'picking'
        ? { kind: 'preparing', progress: START_PREPARE_PROGRESS }
        : state;
    case 'progress':
      return state.kind === 'preparing' ? { kind: 'preparing', progress: event.progress } : state;
    case 'picked':
      return { kind: 'ready' };
    case 'canceled':
      return { kind: 'canceled' };
    case 'failed':
      return { kind: 'error', message: event.message };
    case 'dismiss':
      return state.kind === 'error' ? { kind: 'idle' } : state;
  }
}
