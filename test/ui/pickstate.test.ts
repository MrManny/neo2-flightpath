import { describe, expect, it } from 'vitest';

import { pickReducer } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

describe('pickReducer', () => {
  it('moves to busy on pick', () => {
    expect(pickReducer({ kind: 'idle' }, { type: 'pick' })).toEqual({ kind: 'busy' });
  });

  it('ignores pick while a pick is in progress', () => {
    expect(pickReducer({ kind: 'busy' }, { type: 'pick' })).toEqual({ kind: 'busy' });
  });

  it('moves to ready when a recording is picked', () => {
    expect(pickReducer({ kind: 'busy' }, { type: 'picked' })).toEqual({ kind: 'ready' });
  });

  it('records the cancel', () => {
    expect(pickReducer({ kind: 'busy' }, { type: 'canceled' })).toEqual({ kind: 'canceled' });
  });

  it('carries the failure message', () => {
    const next = pickReducer({ kind: 'busy' }, { type: 'failed', message: 'boom' });
    expect(next).toEqual({ kind: 'error', message: 'boom' });
    expect((next as Extract<PickState, { kind: 'error' }>).message).toBe('boom');
  });
});
