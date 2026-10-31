---
"neo2-flightpath": minor
---

Pivot the desktop app UI to Next.js 16 + Electron: the chrome (landing, pick flow, video player with swappable picture-in-picture layout) is now a componentized Next.js static export served over a privileged `app://` scheme, with picking and session data over validated IPC and no listening socket. The map renderer is one shared implementation in `src/renderer/` used by both the app and the headless CLI; CLI output stays frame-exact and unchanged.
