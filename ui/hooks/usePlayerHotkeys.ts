'use client';

// The player's action map: one dispatch that buttons and hotkeys drive
// alike, plus the key subscription that keeps acting on the latest
// committed state.

import { useEffect, useLayoutEffect, useRef } from 'react';

import { framesForSeconds } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import { mapKey } from '../lib/hotkeys.js';

/** The handlers behind the player's actions. */
export interface PlayerActionHandlers {
  togglePlay: () => void;
  setSpeed: (rate: 1 | 2 | 3 | 4) => void;
  stepBy: (deltaFrames: number) => void;
  scrubTo: (i: number) => void;
  setLoopPoint: (which: 'in' | 'out') => void;
  clearLoop: () => void;
  swap: () => void;
  openRecording: () => void;
  closeOverlay: () => void;
}

export interface PlayerActionContext {
  /** A modal overlay is open: only Escape reaches the dialog logic. */
  modalOpen: boolean;
  fps: number;
  frames: number;
}

export function usePlayerHotkeys(
  handlers: PlayerActionHandlers,
  ctx: PlayerActionContext,
): (action: HotkeyAction) => void {
  const dispatch = (action: HotkeyAction): void => {
    switch (action.type) {
      case 'togglePlay':
        handlers.togglePlay();
        return;
      case 'speed':
        handlers.setSpeed(action.rate);
        return;
      case 'step':
        handlers.stepBy(action.frames);
        return;
      case 'jump':
        handlers.stepBy(framesForSeconds(ctx.fps, action.seconds));
        return;
      case 'seekStart':
        handlers.scrubTo(0);
        return;
      case 'seekEnd':
        handlers.scrubTo(ctx.frames - 1);
        return;
      case 'setLoopIn':
        handlers.setLoopPoint('in');
        return;
      case 'setLoopOut':
        handlers.setLoopPoint('out');
        return;
      case 'clearLoop':
        handlers.clearLoop();
        return;
      case 'swapView':
        handlers.swap();
        return;
      case 'openRecording':
        handlers.openRecording();
        return;
      case 'closeOverlay':
        handlers.closeOverlay();
        return;
    }
  };

  // Hotkeys must act on the latest committed state: when the handler lived
  // inside the subscribing effect, a key landing between a commit and its
  // passive effects ran a stale closure and silently no-oped (#62).
  const hotkeyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    hotkeyHandlerRef.current = (e: KeyboardEvent): void => {
      const action = mapKey(e, { modalOpen: ctx.modalOpen });
      if (action === null) return;
      // No page scroll on Space, no double toggle on a focused button.
      e.preventDefault();
      e.stopPropagation();
      dispatch(action);
    };
  });

  // Capture phase so claimed keys win over the map's keyboard pan/zoom; keys
  // this player does not claim still reach whatever holds focus. Subscribed
  // once: the handler ref keeps it current, so no key can arrive between a
  // commit and a re-subscribe.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => hotkeyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return dispatch;
}
