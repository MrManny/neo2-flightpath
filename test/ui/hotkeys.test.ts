import { describe, expect, it } from 'vitest';

import type { HotkeyAction, HotkeyEvent } from '../../ui/lib/hotkeys.js';
import { mapKey } from '../../ui/lib/hotkeys.js';

const PLAYING = { modalOpen: false };
const MODAL = { modalOpen: true };

const input = { tagName: 'INPUT' };
const select = { tagName: 'SELECT' };
const textarea = { tagName: 'textarea' };
const button = { tagName: 'BUTTON' };

interface Case {
  name: string;
  event: HotkeyEvent;
  ctx?: { modalOpen: boolean };
  want: HotkeyAction | null;
}

describe('mapKey', () => {
  it.for<Case>([
    { name: 'Space toggles play', event: { key: ' ' }, want: { type: 'togglePlay' } },
    { name: 'legacy Spacebar toggles play', event: { key: 'Spacebar' }, want: { type: 'togglePlay' } },
    { name: 'K toggles play', event: { key: 'k' }, want: { type: 'togglePlay' } },
    { name: 'shift+K toggles play', event: { key: 'K', shiftKey: true }, want: { type: 'togglePlay' } },
    { name: 'Space on a button claims the key', event: { key: ' ', target: button }, want: { type: 'togglePlay' } },
    ...([1, 2, 3, 4] as const).map(
      (rate): Case => ({
        name: `digit ${rate} sets speed ${rate}x`,
        event: { key: String(rate) },
        want: { type: 'speed', rate },
      }),
    ),
    { name: 'shifted digit is not a speed', event: { key: '!', shiftKey: true }, want: null },
    { name: 'ArrowLeft steps back a frame', event: { key: 'ArrowLeft' }, want: { type: 'step', frames: -1 } },
    { name: 'ArrowRight steps forward a frame', event: { key: 'ArrowRight' }, want: { type: 'step', frames: 1 } },
    {
      name: 'shift+ArrowLeft jumps back a second',
      event: { key: 'ArrowLeft', shiftKey: true },
      want: { type: 'jump', seconds: -1 },
    },
    {
      name: 'shift+ArrowRight jumps forward a second',
      event: { key: 'ArrowRight', shiftKey: true },
      want: { type: 'jump', seconds: 1 },
    },
    { name: 'held arrow keeps stepping', event: { key: 'ArrowRight', repeat: true }, want: { type: 'step', frames: 1 } },
    { name: 'Home jumps to the start', event: { key: 'Home' }, want: { type: 'seekStart' } },
    { name: 'End jumps to the end', event: { key: 'End' }, want: { type: 'seekEnd' } },
    { name: 'I sets the loop in point', event: { key: 'i' }, want: { type: 'setLoopIn' } },
    { name: 'shift+I sets the loop in point', event: { key: 'I', shiftKey: true }, want: { type: 'setLoopIn' } },
    { name: 'O sets the loop out point', event: { key: 'o' }, want: { type: 'setLoopOut' } },
    { name: 'shift+O sets the loop out point', event: { key: 'O', shiftKey: true }, want: { type: 'setLoopOut' } },
    { name: 'S swaps the views', event: { key: 's' }, want: { type: 'swapView' } },
    { name: 'shift+S swaps the views', event: { key: 'S', shiftKey: true }, want: { type: 'swapView' } },
    { name: 'Ctrl+O opens a recording', event: { key: 'o', ctrlKey: true }, want: { type: 'openRecording' } },
    { name: 'Ctrl+O works while typing', event: { key: 'o', ctrlKey: true, target: input }, want: { type: 'openRecording' } },
    { name: 'Esc clears the loop', event: { key: 'Escape' }, want: { type: 'clearLoop' } },
    { name: 'Esc closes an open overlay', event: { key: 'Escape' }, ctx: MODAL, want: { type: 'closeOverlay' } },
    {
      name: 'Esc from a text field still acts',
      event: { key: 'Escape', target: input },
      ctx: MODAL,
      want: { type: 'closeOverlay' },
    },
    { name: 'unknown keys are ignored', event: { key: 'x' }, want: null },
    { name: 'F5 is left to the platform', event: { key: 'F5' }, want: null },
    { name: 'held Space does not flicker play/pause', event: { key: ' ', repeat: true }, want: null },
    { name: 'held S does not flicker the layout', event: { key: 's', repeat: true }, want: null },
    { name: 'held I does not chase the frame', event: { key: 'i', repeat: true }, want: null },
    { name: 'held Ctrl+O does not re-open', event: { key: 'o', ctrlKey: true, repeat: true }, want: null },
    { name: 'Ctrl+Shift+O is not the open shortcut', event: { key: 'o', ctrlKey: true, shiftKey: true }, want: null },
    { name: 'Ctrl+Space is not play/pause', event: { key: ' ', ctrlKey: true }, want: null },
    { name: 'Alt+O is left to the menu system', event: { key: 'o', altKey: true }, want: null },
    { name: 'Meta+O is left to the OS', event: { key: 'o', metaKey: true }, want: null },
    { name: 'digits are inert in a number field', event: { key: '3', target: input }, want: null },
    { name: 'Space is inert in a text field', event: { key: ' ', target: textarea }, want: null },
    { name: 'letters are inert in a select', event: { key: 's', target: select }, want: null },
    { name: 'arrows are inert in a scrubber field', event: { key: 'ArrowRight', target: input }, want: null },
    { name: 'Esc leaves a select dropdown alone', event: { key: 'Escape', target: select }, ctx: MODAL, want: null },
    {
      name: 'Esc leaves a select dropdown alone without modal',
      event: { key: 'Escape', target: select },
      want: null,
    },
  ])('$name', ({ event, ctx, want }) => {
    expect(mapKey(event, ctx ?? PLAYING)).toEqual(want);
  });

  it.for<Case>([
    { name: 'Space while a modal is open', event: { key: ' ' }, ctx: MODAL, want: null },
    { name: 'arrows while a modal is open', event: { key: 'ArrowRight' }, ctx: MODAL, want: null },
    { name: 'speed keys while a modal is open', event: { key: '2' }, ctx: MODAL, want: null },
    { name: 'loop keys while a modal is open', event: { key: 'i' }, ctx: MODAL, want: null },
    { name: 'swap while a modal is open', event: { key: 's' }, ctx: MODAL, want: null },
    { name: 'Ctrl+O while a modal is open', event: { key: 'o', ctrlKey: true }, ctx: MODAL, want: null },
  ])('$name is inert', ({ event, ctx, want }) => {
    expect(mapKey(event, ctx ?? MODAL)).toEqual(want);
  });
});
