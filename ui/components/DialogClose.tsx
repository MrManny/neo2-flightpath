'use client';

import { CloseIcon } from '../icons/CloseIcon.js';

export interface DialogCloseProps {
  onClose: () => void;
  /** Set while closing would interrupt running work: the control stays visible, disabled, and says why. */
  blockedReason?: string;
}

// Every dialog dismisses through this one control, so the header never changes
// shape between phases.
export function DialogClose({ onClose, blockedReason }: DialogCloseProps) {
  return (
    <button
      type="button"
      className="dialog-close"
      aria-label="Close"
      title={blockedReason}
      disabled={blockedReason !== undefined}
      onClick={onClose}
    >
      <CloseIcon />
      Close
    </button>
  );
}
