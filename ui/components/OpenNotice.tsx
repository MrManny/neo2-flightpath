'use client';

import { describeError } from '../lib/errortext.js';
import type { PickState } from '../lib/pickstate.js';
import { prepareNoticeText, preparePercent } from '../lib/preparetext.js';
import { Notice } from './Notice.js';
import { ProgressBar } from './ProgressBar.js';

export interface OpenNoticeProps {
  state: PickState;
  onDismiss?: () => void;
}

// The Open flow speaks through one notice, whether it runs on the landing or
// over the player. Idle and picking stay silent. Preparing also shows the
// loading progress bar the stage copy describes.
export function OpenNotice({ state, onDismiss }: OpenNoticeProps) {
  switch (state.kind) {
    case 'preparing':
      return (
        <div className="prepare-status">
          <ProgressBar label="Preparation progress" percent={preparePercent(state.progress)} />
          <Notice tone="info">{prepareNoticeText(state.progress)}</Notice>
        </div>
      );
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
