import { describe, expect, it } from 'vitest';

import type { PrepareProgress } from '../../src/run.js';
import { START_PREPARE_PROGRESS, pickReducer } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

const PREPARING: PickState = { kind: 'preparing', progress: START_PREPARE_PROGRESS };

const WARMING: PrepareProgress = {
  stage: 'tiles',
  done: 15,
  total: 51,
  tilesDone: 12,
  tilesTotal: 48,
};

describe('pickReducer', () => {
  it('moves to picking while the native dialog is open', () => {
    expect(pickReducer({ kind: 'idle' }, { type: 'pick' })).toEqual({ kind: 'picking' });
  });

  it('starts preparing at the first step only when the backend reports a valid file', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'preparing' })).toEqual(PREPARING);
  });

  it('follows the reported preparation progress', () => {
    expect(pickReducer(PREPARING, { type: 'progress', progress: WARMING })).toEqual({
      kind: 'preparing',
      progress: WARMING,
    });
  });

  it('moves to ready when the recording is loaded', () => {
    expect(pickReducer(PREPARING, { type: 'picked' })).toEqual({ kind: 'ready' });
  });

  it('records the cancel', () => {
    expect(pickReducer({ kind: 'picking' }, { type: 'canceled' })).toEqual({ kind: 'canceled' });
  });

  it('carries the failure message', () => {
    const next = pickReducer(PREPARING, { type: 'failed', message: 'boom' });
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

describe.each<PickState>([{ kind: 'picking' }, PREPARING])('a second pick while $kind', (state) => {
  it('is ignored, so one Open never starts two dialogs', () => {
    expect(pickReducer(state, { type: 'pick' })).toBe(state);
  });
});

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
  { kind: 'ready' },
  { kind: 'canceled' },
  { kind: 'error', message: 'boom' },
])('a progress report from $kind', (state) => {
  it('is ignored: only an open preparation tracks progress', () => {
    expect(pickReducer(state, { type: 'progress', progress: WARMING })).toBe(state);
  });
});

describe.each<PickState>([
  { kind: 'idle' },
  { kind: 'picking' },
  PREPARING,
  { kind: 'ready' },
  { kind: 'canceled' },
])('dismiss from $kind', (state) => {
  it('leaves the state unchanged: only a failure can be dismissed', () => {
    expect(pickReducer(state, { type: 'dismiss' })).toBe(state);
  });
});
