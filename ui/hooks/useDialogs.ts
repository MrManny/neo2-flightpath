'use client';

// Dialog visibility wiring: one machine decides which dialog is open and
// whether anything may close it, so Escape, the backdrop and the header
// close share one rule (the pure rules live in dialogstate.ts).

import { useReducer } from 'react';

import type { DialogEvent } from '../lib/dialogstate.js';
import { canDismiss, dialogReducer } from '../lib/dialogstate.js';

export interface Dialogs {
  /** A modal overlay is open: player shortcuts are off. */
  modalOpen: boolean;
  settingsOpen: boolean;
  exportOpen: boolean;
  /** The one dismissal rule, for Escape, the backdrop and the header close. */
  dismissible: boolean;
  dispatchDialog: (event: DialogEvent) => void;
}

export function useDialogs(): Dialogs {
  const [dialog, dispatchDialog] = useReducer(dialogReducer, 'closed');
  return {
    modalOpen: dialog !== 'closed',
    settingsOpen: dialog === 'settings',
    exportOpen: dialog === 'export-form' || dialog === 'export-running',
    dismissible: canDismiss(dialog),
    dispatchDialog,
  };
}
