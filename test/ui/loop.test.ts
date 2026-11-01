import { describe, expect, it } from 'vitest';

import { engagedLoop, hasLoop } from '../../ui/lib/loop.js';

describe('engagedLoop', () => {
  it.for([
    {
      name: 'both points set and ordered engages',
      state: { in: 10, out: 20 },
      want: { in: 10, out: 20 },
    },
    { name: 'missing in point stays dormant', state: { in: null, out: 20 }, want: null },
    { name: 'missing out point stays dormant', state: { in: 10, out: null }, want: null },
    { name: 'inverted points stay dormant', state: { in: 20, out: 10 }, want: null },
    { name: 'equal points stay dormant', state: { in: 15, out: 15 }, want: null },
    { name: 'no points at all stays dormant', state: { in: null, out: null }, want: null },
  ])('$name', ({ state, want }) => {
    expect(engagedLoop(state)).toEqual(want);
  });
});

describe('hasLoop', () => {
  it.for([
    { name: 'both points set', state: { in: 10, out: 20 }, want: true },
    { name: 'half-marked loop counts', state: { in: 10, out: null }, want: true },
    { name: 'out point alone counts', state: { in: null, out: 20 }, want: true },
    { name: 'no points at all', state: { in: null, out: null }, want: false },
  ])('$name', ({ state, want }) => {
    expect(hasLoop(state)).toBe(want);
  });
});
