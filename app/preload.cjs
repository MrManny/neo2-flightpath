// Preload bridge for the UI: the only surface the renderer sees. CommonJS
// (.cjs) because sandboxed preload scripts cannot use ESM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neo2flightpath', {
  pickRecording: () => ipcRenderer.invoke('neo2flightpath:pick'),
  getSession: () => ipcRenderer.invoke('neo2flightpath:session'),
  getSettings: () => ipcRenderer.invoke('neo2flightpath:settings'),
  pickExportOutput: () => ipcRenderer.invoke('neo2flightpath:export:pick-output'),
  startExport: (request) => ipcRenderer.invoke('neo2flightpath:export:start', request),
  cancelExport: () => ipcRenderer.invoke('neo2flightpath:export:cancel'),
  revealExportOutput: (out) => ipcRenderer.invoke('neo2flightpath:export:reveal', out),
  openExportOutput: (out) => ipcRenderer.invoke('neo2flightpath:export:open', out),
  onExportProgress: (cb) => {
    const handler = (_event, message) => cb(message);
    ipcRenderer.on('neo2flightpath:export:progress', handler);
    return () => ipcRenderer.removeListener('neo2flightpath:export:progress', handler);
  },
  onExportDone: (cb) => {
    const handler = (_event, outcome) => cb(outcome);
    ipcRenderer.on('neo2flightpath:export:done', handler);
    return () => ipcRenderer.removeListener('neo2flightpath:export:done', handler);
  },
});
