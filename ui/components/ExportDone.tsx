'use client';

import type { RecordingSummary } from '../../src/run.js';
import { formatExportSummary } from '../lib/exportsummary.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';

export interface ExportDoneProps {
  result: RecordingSummary;
  error: string | null;
  onReveal: () => void;
  onOpen: () => void;
  onClose: () => void;
}

export function ExportDone({ result, error, onReveal, onOpen, onClose }: ExportDoneProps) {
  return (
    <>
      {error ? <ErrorNotice message={error} /> : null}
      <Notice tone="info">{formatExportSummary(result)}</Notice>
      <p className="export-path">{result.out}</p>
      <div className="dialog-actions">
        <button type="button" onClick={onReveal}>
          Reveal in folder
        </button>
        <button type="button" onClick={onOpen}>
          Open video
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
