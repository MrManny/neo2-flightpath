// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerActionHandlers } from '../../ui/hooks/usePlayerHotkeys.js';
import { usePlayerHotkeys } from '../../ui/hooks/usePlayerHotkeys.js';
import type { HotkeyAction } from '../../ui/lib/hotkeys.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CTX = { modalOpen: false, fps: 30, frames: 90 };

function fakeHandlers(): PlayerActionHandlers {
  return {
    togglePlay: vi.fn(),
    setSpeed: vi.fn(),
    stepBy: vi.fn(),
    scrubTo: vi.fn(),
    setLoopPoint: vi.fn(),
    clearLoop: vi.fn(),
    swap: vi.fn(),
    openRecording: vi.fn(),
    closeOverlay: vi.fn(),
  };
}

function mountHotkeys(handlers: PlayerActionHandlers, ctx = CTX) {
  return renderHook((h: PlayerActionHandlers) => usePlayerHotkeys(h, ctx), {
    initialProps: handlers,
  });
}

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.repeat) Object.defineProperty(event, 'repeat', { value: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('usePlayerHotkeys action map', () => {
  it.for<{ name: string; action: HotkeyAction; verify: (h: PlayerActionHandlers) => void }>([
    {
      name: 'togglePlay plays and pauses',
      action: { type: 'togglePlay' },
      verify: (h) => expect(h.togglePlay).toHaveBeenCalledTimes(1),
    },
    {
      name: 'speed sets the rate',
      action: { type: 'speed', rate: 3 },
      verify: (h) => expect(h.setSpeed).toHaveBeenCalledWith(3),
    },
    {
      name: 'step steps the frame delta',
      action: { type: 'step', frames: -1 },
      verify: (h) => expect(h.stepBy).toHaveBeenCalledWith(-1),
    },
    {
      name: 'jump converts the second to frames',
      action: { type: 'jump', seconds: 1 },
      verify: (h) => expect(h.stepBy).toHaveBeenCalledWith(30),
    },
    {
      name: 'seekStart seeks to the first frame',
      action: { type: 'seekStart' },
      verify: (h) => expect(h.scrubTo).toHaveBeenCalledWith(0),
    },
    {
      name: 'seekEnd seeks to the last frame',
      action: { type: 'seekEnd' },
      verify: (h) => expect(h.scrubTo).toHaveBeenCalledWith(89),
    },
    {
      name: 'setLoopIn marks the in point',
      action: { type: 'setLoopIn' },
      verify: (h) => expect(h.setLoopPoint).toHaveBeenCalledWith('in'),
    },
    {
      name: 'setLoopOut marks the out point',
      action: { type: 'setLoopOut' },
      verify: (h) => expect(h.setLoopPoint).toHaveBeenCalledWith('out'),
    },
    {
      name: 'clearLoop clears the region',
      action: { type: 'clearLoop' },
      verify: (h) => expect(h.clearLoop).toHaveBeenCalledTimes(1),
    },
    {
      name: 'swapView swaps the panes',
      action: { type: 'swapView' },
      verify: (h) => expect(h.swap).toHaveBeenCalledTimes(1),
    },
    {
      name: 'openRecording opens a recording',
      action: { type: 'openRecording' },
      verify: (h) => expect(h.openRecording).toHaveBeenCalledTimes(1),
    },
    {
      name: 'closeOverlay closes the dialog',
      action: { type: 'closeOverlay' },
      verify: (h) => expect(h.closeOverlay).toHaveBeenCalledTimes(1),
    },
  ])('$name', ({ action, verify }) => {
    const handlers = fakeHandlers();
    const { result } = mountHotkeys(handlers);
    act(() => {
      result.current(action);
    });
    verify(handlers);
  });
});

describe('usePlayerHotkeys key subscription', () => {
  it('claims mapped keys and dispatches their action', () => {
    const handlers = fakeHandlers();
    mountHotkeys(handlers);
    const event = pressKey({ key: ' ' });
    expect(handlers.togglePlay).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves unclaimed keys to their default behavior', () => {
    const handlers = fakeHandlers();
    mountHotkeys(handlers);
    const event = pressKey({ key: 'x' });
    expect(event.defaultPrevented).toBe(false);
    expect(handlers.togglePlay).not.toHaveBeenCalled();
    expect(handlers.openRecording).not.toHaveBeenCalled();
  });

  it('keeps only Escape live while a modal is open', () => {
    const handlers = fakeHandlers();
    mountHotkeys(handlers, { ...CTX, modalOpen: true });
    pressKey({ key: ' ' });
    pressKey({ key: 'o', ctrlKey: true });
    expect(handlers.togglePlay).not.toHaveBeenCalled();
    expect(handlers.openRecording).not.toHaveBeenCalled();
    pressKey({ key: 'Escape' });
    expect(handlers.closeOverlay).toHaveBeenCalledTimes(1);
  });

  it('subscribes once and still acts on the latest handlers (#62)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const first = fakeHandlers();
    const second = fakeHandlers();
    const { rerender } = mountHotkeys(first);
    rerender(second);
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    pressKey({ key: ' ' });
    expect(second.togglePlay).toHaveBeenCalledTimes(1);
    expect(first.togglePlay).not.toHaveBeenCalled();
  });
});
