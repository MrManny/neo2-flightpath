// The Open flow. "picking" covers the native dialog, so nothing is shown yet;
// "preparing" starts only when the backend reports a file that passed its checks.
export type PickState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

export type PickEvent =
  | { type: 'pick' }
  | { type: 'preparing' }
  | { type: 'picked' }
  | { type: 'canceled' }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' };

export function pickReducer(state: PickState, event: PickEvent): PickState {
  switch (event.type) {
    case 'pick':
      return state.kind === 'picking' || state.kind === 'preparing' ? state : { kind: 'picking' };
    case 'preparing':
      return state.kind === 'picking' ? { kind: 'preparing' } : state;
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
