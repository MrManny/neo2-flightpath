// Preload bridge for the UI: the only surface the renderer sees. CommonJS
// (.cjs) because sandboxed preload scripts cannot use ESM.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, adapt) {
  const handler = (_event, payload) => adapt(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('neo2flightpath', {
  pickRecording: () => ipcRenderer.invoke('neo2flightpath:pick'),
  getSession: () => ipcRenderer.invoke('neo2flightpath:session'),
  getSettings: () => ipcRenderer.invoke('neo2flightpath:settings'),
  pickExportOutput: () => ipcRenderer.invoke('neo2flightpath:export:pick-output'),
  startExport: (request) => ipcRenderer.invoke('neo2flightpath:export:start', request),
  cancelExport: () => ipcRenderer.invoke('neo2flightpath:export:cancel'),
  revealExportOutput: (out) => ipcRenderer.invoke('neo2flightpath:export:reveal', out),
  openExportOutput: (out) => ipcRenderer.invoke('neo2flightpath:export:open', out),
  onExportProgress: (cb) => subscribe('neo2flightpath:export:progress', cb),
  onExportDone: (cb) => subscribe('neo2flightpath:export:done', cb),
  onPreparing: (cb) => subscribe('neo2flightpath:preparing', () => cb()),
  onPrepareProgress: (cb) => subscribe('neo2flightpath:preparing:progress', cb),
});
