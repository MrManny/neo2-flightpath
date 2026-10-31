---
"neo2-flightpath": patch
---

Fix the Desktop build workflow so the Windows portable artifact is produced again: the electron-builder config override was split into a separate `-c` and a bogus config file path by npm's Windows argument forwarding, which made the win-x64 build fail before packaging.
