// Preload bridge for the UI: the only surface the renderer sees. CommonJS
// (.cjs) because sandboxed preload scripts cannot use ESM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neo2flightpath', {
  pickRecording: () => ipcRenderer.invoke('neo2flightpath:pick'),
  getSession: () => ipcRenderer.invoke('neo2flightpath:session'),
  getSettings: () => ipcRenderer.invoke('neo2flightpath:settings'),
});
