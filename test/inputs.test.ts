import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectRecordings } from '../src/inputs.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2in-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('collectRecordings', () => {
  it('collects .mp4 case-insensitively, non-recursively by default', () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'a.mp4'), '');
    fs.writeFileSync(path.join(root, 'B.MP4'), '');
    fs.writeFileSync(path.join(root, 'c.mov'), '');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'd.mp4'), '');

    const flat = collectRecordings([root], { recurse: false });
    expect(flat).toHaveLength(2);

    const deep = collectRecordings([root], { recurse: true });
    expect(deep).toHaveLength(3);
  });

  it('accepts explicit .mp4 files and rejects others', () => {
    const root = tmpDir();
    const mp4 = path.join(root, 'a.mp4');
    fs.writeFileSync(mp4, '');
    const mov = path.join(root, 'b.mov');
    fs.writeFileSync(mov, '');

    expect(collectRecordings([mp4], { recurse: false })).toEqual([
      path.resolve(mp4),
    ]);
    expect(() => collectRecordings([mov], { recurse: false })).toThrow(
      /not an \.mp4/,
    );
  });

  it('rejects missing inputs and empty scans', () => {
    expect(() =>
      collectRecordings([path.join(os.tmpdir(), 'nope-not-here-xyz')], {
        recurse: false,
      }),
    ).toThrow(/input not found/);
    const empty = tmpDir();
    expect(() => collectRecordings([empty], { recurse: false })).toThrow(
      /no \.mp4 recordings/,
    );
  });

  it('de-duplicates overlapping inputs and sorts', () => {
    const root = tmpDir();
    const a = path.join(root, 'a.mp4');
    fs.writeFileSync(a, '');
    const files = collectRecordings([root, a], { recurse: false });
    expect(files).toEqual([path.resolve(a)]);
  });
});
