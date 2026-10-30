// The renderer's view of the app backend. In Electron this is the preload
// bridge (contextBridge + validated IPC); without it the UI cannot drive the
// native dialog or the pipeline.

import type { PickResult, UiSession } from '../../src/appsession.js';
import type { ExportRequest, RenderConfig } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';

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

export interface AppBridge {
  pickRecording(): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
  getSettings(): Promise<RenderConfig>;
  pickExportOutput(): Promise<PickOutputResult>;
  startExport(request: ExportRequest): Promise<ExportAck>;
  cancelExport(): Promise<ExportAck>;
  revealExportOutput(out: string): Promise<ExportAck>;
  openExportOutput(out: string): Promise<ExportAck>;
  onExportProgress(cb: (message: string) => void): () => void;
  onExportDone(cb: (outcome: ExportOutcome) => void): () => void;
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
