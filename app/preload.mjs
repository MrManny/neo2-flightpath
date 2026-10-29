// Preload bridge for the UI: the only surface the renderer sees. Sandbox-safe
// by construction (contextBridge + ipcRenderer only).

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('neo2flightpath', {
  pickRecording: () => ipcRenderer.invoke('neo2flightpath:pick'),
  getSession: () => ipcRenderer.invoke('neo2flightpath:session'),
});
