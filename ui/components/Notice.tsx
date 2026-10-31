'use client';

import type { ReactNode } from 'react';

import { CloseIcon } from '../icons/CloseIcon.js';

export type NoticeTone = 'info' | 'warning' | 'danger';

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** The original technical text, folded away so the sentence stays the focus. */
  details?: string | null;
  onDismiss?: () => void;
}

// The one status pattern for every surface: same placement, type size and tone
// tokens in the landing, the player and the export dialog.
export function Notice({ tone, children, details, onDismiss }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="notice-body">
        <p className="notice-text">{children}</p>
        {details ? (
          <details className="notice-details">
            <summary>Technical details</summary>
            <pre>{details}</pre>
          </details>
        ) : null}
      </div>
      {onDismiss ? (
        <button type="button" className="notice-dismiss" onClick={onDismiss}>
          <CloseIcon />
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
