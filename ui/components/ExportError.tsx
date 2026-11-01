'use client';

import { ErrorNotice } from './ErrorNotice.js';

export interface ExportErrorProps {
  error: string;
  onClose: () => void;
}

// Every failure here is an export outcome: the job wrote beside the
// destination and never replaced it, so the phase can promise it is intact.
export function ExportError({ error, onClose }: ExportErrorProps) {
  return (
    <>
      <ErrorNotice message={error} tail="The destination file was left untouched." />
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
