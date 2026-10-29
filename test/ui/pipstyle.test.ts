import { describe, expect, it } from 'vitest';

import { pipStyle } from '../../ui/lib/pipstyle.js';

describe('pipStyle', () => {
  it.for([
    {
      name: 'the map fills the pip box',
      holdsVideo: false,
      w: 1920,
      h: 1080,
      want: { aspectRatio: '16 / 9', width: '30%', height: 'auto' },
    },
    {
      name: 'landscape footage fills by width',
      holdsVideo: true,
      w: 1920,
      h: 1080,
      want: { aspectRatio: '1920 / 1080', width: '30%', height: 'auto' },
    },
    {
      name: 'portrait footage binds by height',
      holdsVideo: true,
      w: 1512,
      h: 2688,
      want: { aspectRatio: '1512 / 2688', width: 'auto', height: '45%' },
    },
    {
      name: 'zero dimensions fall back to the map box',
      holdsVideo: true,
      w: 0,
      h: 0,
      want: { aspectRatio: '16 / 9', width: '30%', height: 'auto' },
    },
  ])('$name', ({ holdsVideo, w, h, want }) => {
    expect(pipStyle(holdsVideo, w, h)).toEqual(want);
  });
});
