export type PickState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ready' }
  | { kind: 'canceled' }
  | { kind: 'error'; message: string };

export type PickEvent =
  | { type: 'pick' }
  | { type: 'picked' }
  | { type: 'canceled' }
  | { type: 'failed'; message: string };

export function pickReducer(state: PickState, event: PickEvent): PickState {
  switch (event.type) {
    case 'pick':
      return state.kind === 'busy' ? state : { kind: 'busy' };
    case 'picked':
      return { kind: 'ready' };
    case 'canceled':
      return { kind: 'canceled' };
    case 'failed':
      return { kind: 'error', message: event.message };
  }
}
