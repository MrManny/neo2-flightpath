// Path identity and collision-free output naming have exactly one home.
// Identity follows the platform's own file-name rules: Windows file names
// are case-insensitive, POSIX file names are case-sensitive. The same
// inputs can therefore plan different names per platform, deterministic
// and idempotent on each. Case-insensitive macOS volumes are treated like
// POSIX: folding darwin too would merge two genuinely distinct files on
// case-sensitive volumes, and the desktop matrix is Windows + Linux.

import path from 'node:path';

// Resolved so separator and `..` spellings of one file share a key;
// toLowerCase is locale-independent, so the key stays deterministic.
export function pathKey(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = platform === 'win32' ? path.win32.resolve(p) : path.posix.resolve(p);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

// First free name `stem.ext`, `stem-2.ext`, `stem-3.ext`, ... in dir. The
// caller says what "taken" means (names planned in this run, or files on
// disk); existing names are never reused or deleted.
export function uniquePath(
  dir: string,
  stem: string,
  ext: string,
  isTaken: (candidate: string) => boolean,
): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const candidate = path.join(dir, name);
    if (!isTaken(candidate)) return candidate;
  }
}
