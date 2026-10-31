import { describe, expect, it } from 'vitest';

import { pickReducer } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

describe('pickReducer', () => {
  it('moves to picking while the native dialog is open', () => {
    expect(pickReducer({ kind: 'idle' }, { type: 'pick' })).toEqual({ kind: 'picking' });
  });

  it('starts preparing only when the backend reports a valid file', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'preparing' })).toEqual({ kind: 'preparing' });
  });

  it('moves to ready when the recording is loaded', () => {
    expect(pickReducer({ kind: 'preparing' }, { type: 'picked' })).toEqual({ kind: 'ready' });
  });

  it('records the cancel', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'canceled' })).toEqual({ kind: 'canceled' });
  });

  it('carries the failure message', () => {
    const next = pickReducer({ kind: 'preparing' }, { type: 'failed', message: 'boom' });
    expect(next).toEqual({ kind: 'error', message: 'boom' });
    expect((next as Extract<PickState, { kind: 'error' }>).message).toBe('boom');
  });

  it('starts a new pick after a failure', () => {
    expect(pickReducer({ kind: 'error', message: 'boom' }, { type: 'pick' })).toEqual({ kind: 'picking' });
  });

  it('dismisses a failure back to idle', () => {
    expect(pickReducer({ kind: 'error', message: 'boom' }, { type: 'dismiss' })).toEqual({ kind: 'idle' });
  });
});

describe.each<PickState>([{ kind: 'picking' }, { kind: 'preparing' }])(
  'a second pick while $kind',
  (state) => {
    it('is ignored, so one Open never starts two dialogs', () => {
      expect(pickReducer(state, { type: 'pick' })).toBe(state);
    });
  },
);

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'ready' },
  { kind: 'canceled' },
  { kind: 'error', message: 'boom' },
])('a preparing signal from $kind', (state) => {
  it('does not start preparing without an open pick, so no busy status appears early', () => {
    expect(pickReducer(state, { type: 'preparing' })).toBe(state);
  });
});

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'picking' },
  { kind: 'preparing' },
  { kind: 'ready' },
  { kind: 'canceled' },
])('dismiss from $kind', (state) => {
  it('leaves the state unchanged: only a failure can be dismissed', () => {
    expect(pickReducer(state, { type: 'dismiss' })).toBe(state);
  });
});
