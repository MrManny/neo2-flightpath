'use client';

import { describeError } from '../lib/errortext.js';
import { Notice } from './Notice.js';

export interface ErrorNoticeProps {
  /** The raw message from the app backend or Node. */
  message: string;
  /** Sentence before the description, e.g. the Open flow's prefix. */
  lead?: string;
  /** Sentence after the description, e.g. the export outcome's suffix. */
  tail?: string;
  onDismiss?: () => void;
}

// The describeError -> danger Notice pipeline in one place: one actionable
// sentence up front, the original message under "Technical details".
export function ErrorNotice({ message, lead, tail, onDismiss }: ErrorNoticeProps) {
  const { text, technical } = describeError(message);
  return (
    <Notice tone="danger" details={technical} onDismiss={onDismiss}>
      {`${lead ? `${lead} ` : ''}${text}${tail ? ` ${tail}` : ''}`}
    </Notice>
  );
}
