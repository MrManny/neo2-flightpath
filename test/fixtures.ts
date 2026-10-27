// Shared test fixtures.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Temporary directories created via tmpDir(), removed by cleanupTmpDirs()
// (call it from afterEach).
const tmpDirs: string[] = [];

export function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2-test-'));
  tmpDirs.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Three cues: two with GPS fixes, one with no GPS lock (0/0) in between.
// Cue 1 includes extra exposure fields like real Neo 2 sidecars.
export const SRT_SAMPLE = `1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-05-25 09:18:11.708
[iso: 340] [shutter: 1/400.0] [fnum: 2.2] [ev: 0] [ct: 4435] [latitude: 46.613070] [longitude: 14.262388] [rel_alt: 3.300 abs_alt: 313.227] [eis: normal]</font>

2
00:00:00,033 --> 00:00:00,066
<font size="28">FrameCnt: 2, DiffTime: 33ms
2026-05-25 09:18:11.741
[iso: 340] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 3.400 abs_alt: 313.327]</font>

3
00:00:00,066 --> 00:00:00,100
<font size="28">FrameCnt: 3, DiffTime: 34ms
2026-05-25 09:18:11.775
[iso: 340] [latitude: 46.613071] [longitude: 14.262389] [rel_alt: 3.500 abs_alt: 313.427]</font>
`;
