---
"neo2-flightpath": minor
---

Add an export modal to the desktop app: it renders the recording with the look you see in the preview, either as the full recording or as the In–Out loop segment, at a chosen output size, written through a native save dialog. Exports run as one cancelable job; the video is verified before it replaces the chosen file, so a failed or canceled export never touches an existing file.
