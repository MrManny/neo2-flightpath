// Keyboard shortcut vocabulary for the review player as a pure key-to-action
// mapping, so every shortcut and guard rail stays unit-testable away from the
// DOM. Guard rails: shortcuts are inert while focus is in an editable control,
// everything except Esc is inert while a modal overlay is open, and held keys
// auto-repeat only for stepping/jumping (a repeating Space would flicker
// play/pause, a repeating S would flicker the layout).

export type HotkeyAction =
  | { type: 'togglePlay' }
  | { type: 'speed'; rate: 1 | 2 | 3 | 4 }
  | { type: 'step'; frames: -1 | 1 }
  | { type: 'jump'; seconds: -1 | 1 }
  | { type: 'seekStart' }
  | { type: 'seekEnd' }
  | { type: 'setLoopIn' }
  | { type: 'setLoopOut' }
  | { type: 'clearLoop' }
  | { type: 'swapView' }
  | { type: 'openRecording' }
  | { type: 'closeOverlay' };

/** The KeyboardEvent fields the mapping reads; real events satisfy it. */
export interface HotkeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** True while a held key auto-repeats. */
  repeat?: boolean;
  target?: unknown;
}

export interface HotkeyContext {
  /** A modal overlay is open: only Esc gets through. */
  modalOpen: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

function tagNameOf(target: unknown): string {
  const tag = (target as { tagName?: unknown } | null | undefined)?.tagName;
  return typeof tag === 'string' ? tag.toUpperCase() : '';
}

export function mapKey(event: HotkeyEvent, ctx: HotkeyContext): HotkeyAction | null {
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  const tag = tagNameOf(event.target);
  const { key } = event;

  // Esc stands apart: it closes an open overlay from anywhere and clears the
  // loop otherwise. A focused select keeps the key so its native dropdown can
  // close before any overlay does.
  if (key === 'Escape') {
    if (tag === 'SELECT') return null;
    return ctx.modalOpen ? { type: 'closeOverlay' } : { type: 'clearLoop' };
  }

  if (ctx.modalOpen) return null;

  // Ctrl+O stays available while typing; plain O belongs to the loop.
  if (ctrl && !meta && !alt && !shift && (key === 'o' || key === 'O')) {
    return event.repeat === true ? null : { type: 'openRecording' };
  }

  if (EDITABLE_TAGS.has(tag)) return null;
  if (ctrl || meta || alt) return null;

  const directional = key === 'ArrowLeft' || key === 'ArrowRight';
  if (event.repeat === true && !directional) return null;

  switch (key) {
    case ' ':
    case 'Spacebar':
    case 'k':
    case 'K':
      return { type: 'togglePlay' };
    case '1':
      return { type: 'speed', rate: 1 };
    case '2':
      return { type: 'speed', rate: 2 };
    case '3':
      return { type: 'speed', rate: 3 };
    case '4':
      return { type: 'speed', rate: 4 };
    case 'Home':
      return { type: 'seekStart' };
    case 'End':
      return { type: 'seekEnd' };
    case 'i':
    case 'I':
      return { type: 'setLoopIn' };
    case 'o':
    case 'O':
      return { type: 'setLoopOut' };
    case 's':
    case 'S':
      return { type: 'swapView' };
    case 'ArrowLeft':
      return shift ? { type: 'jump', seconds: -1 } : { type: 'step', frames: -1 };
    case 'ArrowRight':
      return shift ? { type: 'jump', seconds: 1 } : { type: 'step', frames: 1 };
    default:
      return null;
  }
}
