import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectRecordings,
  findSrtSidecar,
  isRecordingName,
} from '../src/inputs.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('isRecordingName', () => {
  it.for([
    { name: 'lowercase .mp4', fileName: 'clip.mp4', want: true },
    { name: 'uppercase .MP4', fileName: 'CLIP.MP4', want: true },
    { name: 'mixed-case extensions', fileName: 'clip.Mp4', want: true },
    { name: 'a full path', fileName: path.join('videos', 'CLIP.MP4'), want: true },
    { name: 'a QuickTime file', fileName: 'clip.mov', want: false },
    { name: 'a sidecar', fileName: 'clip.srt', want: false },
    { name: 'a lookalike suffix', fileName: 'clip.mp4.bak', want: false },
    { name: 'an extensionless name', fileName: 'clip', want: false },
  ])('recognizes $name', ({ fileName, want }) => {
    expect(isRecordingName(fileName)).toBe(want);
  });
});

describe('findSrtSidecar', () => {
  it('matches the video basename case-insensitively', () => {
    const root = tmpDir();
    const video = path.join(root, 'clip.mp4');
    fs.writeFileSync(video, '');
    const srt = path.join(root, 'CLIP.SRT');
    fs.writeFileSync(srt, '');
    expect(findSrtSidecar(video)).toBe(srt);
  });

  it('returns null when the recording has no sidecar', () => {
    const root = tmpDir();
    const video = path.join(root, 'clip.mp4');
    fs.writeFileSync(video, '');
    fs.writeFileSync(path.join(root, 'other.srt'), '');
    expect(findSrtSidecar(video)).toBeNull();
  });
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
