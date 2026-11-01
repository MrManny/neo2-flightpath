'use client';

import { Notice } from './Notice.js';

export interface ExportCanceledProps {
  onClose: () => void;
}

export function ExportCanceled({ onClose }: ExportCanceledProps) {
  return (
    <>
      <Notice tone="info">Export canceled; its working file was removed.</Notice>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
