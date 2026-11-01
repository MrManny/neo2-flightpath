'use client';

import { ErrorNotice } from './ErrorNotice.js';
import { ProgressBar } from './ProgressBar.js';

export interface ExportRunningProps {
  /** Latest typed capture fraction; null until the job reports frames. */
  fraction: number | null;
  canceling: boolean;
  error: string | null;
  onCancel: () => void;
}

export function ExportRunning({ fraction, canceling, error, onCancel }: ExportRunningProps) {
  const percent = Math.round((fraction ?? 0) * 100);
  return (
    <>
      <div className="export-progress">
        <ProgressBar label="Export progress" percent={percent} />
        <div className="progress-label">
          {canceling
            ? 'Canceling…'
            : fraction === null
              ? 'Preparing…'
              : `Rendering ${percent}%`}
        </div>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
      <div className="dialog-actions">
        <button type="button" onClick={onCancel} disabled={canceling}>
          Cancel export
        </button>
      </div>
    </>
  );
}
