// The renderer's view of the app backend. In Electron this is the preload
// bridge (contextBridge + validated IPC); without it the UI cannot drive the
// native dialog or the pipeline.

import type { PickResult, UiSession } from '../../src/appsession.js';

export interface AppBridge {
  pickRecording(): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
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
