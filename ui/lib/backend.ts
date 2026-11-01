// The renderer's view of the app backend. In Electron this is the preload
// bridge (contextBridge + validated IPC); without it the UI cannot drive the
// native dialog or the pipeline.

import type { PickResult, UiSession } from '../../src/appsession.js';
import type { ExportRequest, RenderConfig } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from '../../src/render.js';
import type { PrepareProgress } from '../../src/run.js';

export interface PickOutputResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface ExportAck {
  ok: boolean;
  error?: string;
}

/** The done-phase actions name the one file the shell may reveal or open. */
export interface ExportOutputPayload {
  out: string;
}

export interface AppBridge {
  pickRecording(): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
  getSettings(): Promise<RenderConfig>;
  pickExportOutput(): Promise<PickOutputResult>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  openExportOutput(payload: ExportOutputPayload): Promise<ExportAck>;
  onExportProgress(cb: (message: string) => void): () => void;
  /** Typed capture progress, so the export bar needs no log scraping. */
  onExportCapture(cb: (progress: CaptureProgress) => void): () => void;
  onExportDone(cb: (outcome: ExportOutcome) => void): () => void;
  /** The picked recording passed its checks and is being prepared (the picker has closed). */
  onPreparing(cb: () => void): () => void;
  /** The preparation's loading steps, so the busy status can show its progress. */
  onPrepareProgress(cb: (progress: PrepareProgress) => void): () => void;
}

declare global {
  interface Window {
    neo2flightpath?: AppBridge;
  }
}

export function appBridge(): AppBridge {
  const bridge = window.neo2flightpath;
  if (!bridge) throw new Error('app bridge unavailable');
  return bridge;
}
