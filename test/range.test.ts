import { describe, expect, it } from 'vitest';

import { parseRange } from '../src/range.js';

describe('parseRange', () => {
  it.for([
    { name: 'closed range', header: 'bytes=2-5', want: { start: 2, end: 5 } },
    { name: 'open-ended range', header: 'bytes=5-', want: { start: 5, end: 9 } },
    { name: 'suffix range', header: 'bytes=-3', want: { start: 7, end: 9 } },
    { name: 'clamped end', header: 'bytes=8-99', want: { start: 8, end: 9 } },
    { name: 'unsatisfiable range', header: 'bytes=10-', want: 'unsatisfiable' },
    { name: 'zero suffix', header: 'bytes=-0', want: 'unsatisfiable' },
    { name: 'inverted range', header: 'bytes=5-2', want: 'unsatisfiable' },
    { name: 'malformed range is ignored', header: 'bytes=abc', want: null },
    { name: 'empty range is ignored', header: 'bytes=-', want: null },
    { name: 'absent header is ignored', header: undefined, want: null },
    { name: 'reversed suffix past the size', header: 'bytes=-20', want: { start: 0, end: 9 } },
  ])('$name', ({ header, want }) => {
    expect(parseRange(header, 10)).toEqual(want);
  });

  it('takes the first header when several arrive', () => {
    expect(parseRange(['bytes=1-2', 'bytes=3-4'], 10)).toEqual({ start: 1, end: 2 });
  });
});
