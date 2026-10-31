---
"neo2-flightpath": patch
---

Path identity now follows the platform's own file-name rules in one shared rule: on Windows, output names differing only in case are still one file (collision suffixing and the overwrite guard agree on it), while on Linux and macOS they are distinct and keep their plain names instead of being suffixed. Collision suffixes (`name-2.mp4`, ...) and export working-file naming (`name.partial.mp4`, ...) are unchanged and now share one implementation.
