'use client';

import { describeError } from '../lib/errortext.js';
import type { PickState } from '../lib/pickstate.js';
import { Notice } from './Notice.js';

export interface OpenNoticeProps {
  state: PickState;
  onDismiss?: () => void;
}

// The Open flow speaks through one notice, whether it runs on the landing or
// over the player. Idle and picking stay silent.
export function OpenNotice({ state, onDismiss }: OpenNoticeProps) {
  switch (state.kind) {
    case 'preparing':
      return <Notice tone="info">Preparing the recording (telemetry and map tiles)…</Notice>;
    case 'canceled':
      return <Notice tone="info">No recording picked.</Notice>;
    case 'error': {
      const { text, technical } = describeError(state.message);
      return (
        <Notice tone="danger" details={technical} onDismiss={onDismiss}>
          {`Could not open the recording: ${text}`}
        </Notice>
      );
    }
    default:
      return null;
  }
}
