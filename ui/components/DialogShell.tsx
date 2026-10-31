'use client';

import type { ReactNode } from 'react';

import { DialogClose } from './DialogClose.js';

export interface DialogShellProps {
  /** The window title and the dialog's accessible name. */
  title: string;
  onClose: () => void;
  /** Set while closing would interrupt running work: the header close says why and stays disabled. */
  blockedReason?: string;
  /** Backdrop clicks dismiss only while nothing is running. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

// The dialog anatomy the design guidelines define, in one place: overlay,
// panel and header never change shape between dialogs or phases.
export function DialogShell({
  title,
  onClose,
  blockedReason,
  closeOnBackdrop = true,
  children,
}: DialogShellProps) {
  return (
    <div
      className="settings-overlay"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{title}</h2>
          <DialogClose onClose={onClose} blockedReason={blockedReason} />
        </div>
        {children}
      </div>
    </div>
  );
}
