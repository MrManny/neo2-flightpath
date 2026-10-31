import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathKey, samePath, uniquePath } from '../src/paths.js';

describe.for(['win32', 'darwin', 'linux'] as const)(
  'path identity on %s',
  (platform) => {
    const win = platform === 'win32';

    it('matches one file spelled differently (case, separators, dots)', () => {
      const a = win ? 'C:\\media\\clip.mp4' : '/media/clip.mp4';
      const b = win ? 'c:/media/clip.mp4' : '/media/sub/../clip.mp4';
      expect(samePath(a, b, platform)).toBe(true);
      expect(pathKey(a, platform)).toBe(pathKey(b, platform));
    });

    it('separates different files that share a basename', () => {
      const a = win ? 'C:\\media\\a\\clip.mp4' : '/media/a/clip.mp4';
      const b = win ? 'C:\\media\\b\\clip.mp4' : '/media/b/clip.mp4';
      expect(samePath(a, b, platform)).toBe(false);
    });

    it('applies the platform case rule to names differing only in case', () => {
      const a = win ? 'C:\\media\\Clip.mp4' : '/media/Clip.mp4';
      const b = win ? 'C:\\media\\clip.mp4' : '/media/clip.mp4';
      expect(samePath(a, b, platform)).toBe(win);
      expect(pathKey(a, platform) === pathKey(b, platform)).toBe(win);
    });
  },
);

describe('uniquePath', () => {
  const taken =
    (...names: string[]) =>
    (candidate: string): boolean =>
      names.some((name) => candidate === path.join('/out', name));

  it('keeps the plain name when it is free', () => {
    expect(uniquePath('/out', 'clip', '.mp4', taken())).toBe(
      path.join('/out', 'clip.mp4'),
    );
  });

  it.for([
    { name: 'first taken', taken: ['clip.mp4'], want: 'clip-2.mp4' },
    { name: 'first two taken', taken: ['clip.mp4', 'clip-2.mp4'], want: 'clip-3.mp4' },
  ])('walks the -2, -3 sequence when $name', ({ taken: busy, want }) => {
    expect(uniquePath('/out', 'clip', '.mp4', taken(...busy))).toBe(
      path.join('/out', want),
    );
  });

  it('never emits a -1 name and never consumes a stray one', () => {
    expect(uniquePath('/out', 'clip', '.mp4', taken('clip-1.mp4'))).toBe(
      path.join('/out', 'clip.mp4'),
    );
    expect(
      uniquePath('/out', 'clip', '.mp4', taken('clip.mp4', 'clip-1.mp4')),
    ).toBe(path.join('/out', 'clip-2.mp4'));
  });

  it('suffixes adversarial stems before the extension', () => {
    expect(uniquePath('/out', 'my.video', '.mp4', taken('my.video.mp4'))).toBe(
      path.join('/out', 'my.video-2.mp4'),
    );
    expect(uniquePath('/out', 'clip-2', '.mp4', taken('clip-2.mp4'))).toBe(
      path.join('/out', 'clip-2-2.mp4'),
    );
  });
});
