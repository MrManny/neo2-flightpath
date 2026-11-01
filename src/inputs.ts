import fs from 'node:fs';
import path from 'node:path';

// The one recording-extension rule: the CLI input scan and the app's pick
// check share it, so accepting another container (e.g. .MOV) is one edit.
export function isRecordingName(name: string): boolean {
  return name.toLowerCase().endsWith('.mp4');
}

// The recording's stem: sidecar lookup and output naming both key on it.
export function videoBaseName(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

// Sidecar lookup matches the video basename, case-insensitively (.SRT vs .srt).
export function findSrtSidecar(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const base = videoBaseName(videoPath);
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase() === `${base.toLowerCase()}.srt`) {
      return path.join(dir, f);
    }
  }
  return null;
}

function listMp4(dir: string, recurse: boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recurse) found.push(...listMp4(full, recurse));
    } else if (entry.isFile() && isRecordingName(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

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
    } else if (isRecordingName(full)) {
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
