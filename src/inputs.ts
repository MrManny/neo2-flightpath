// inputs.ts - collect .mp4 recordings from files and/or folders.

import fs from 'node:fs';
import path from 'node:path';

function isMp4(name: string): boolean {
  return name.toLowerCase().endsWith('.mp4');
}

function listMp4(dir: string, recurse: boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recurse) found.push(...listMp4(full, recurse));
    } else if (entry.isFile() && isMp4(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// Collect recordings from the given inputs: .mp4 files are taken as-is,
// folders are scanned non-recursively (or recursively with opts.recurse).
// Returns sorted, de-duplicated absolute paths.
export function collectRecordings(
  inputs: string[],
  opts: { recurse: boolean },
): string[] {
  const files: string[] = [];
  for (const item of inputs) {
    const full = path.resolve(item);
    if (!fs.existsSync(full)) throw new Error(`input not found: ${item}`);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      files.push(...listMp4(full, opts.recurse));
    } else if (isMp4(full)) {
      files.push(full);
    } else {
      throw new Error(`not an .mp4 recording: ${full}`);
    }
  }
  const unique = [...new Set(files.map((f) => path.resolve(f)))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  if (unique.length === 0) {
    throw new Error('no .mp4 recordings found in the given input');
  }
  return unique;
}
