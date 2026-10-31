import { describe, expect, it } from 'vitest';

import { parseRange, rangePlan } from '../src/range.js';

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

describe('rangePlan', () => {
  const SIZE = 10;
  const MIME = 'video/mp4';

  const full = {
    status: 200,
    headers: { 'Content-Type': MIME, 'Accept-Ranges': 'bytes', 'Content-Length': '10' },
  };
  const notSatisfiable = {
    status: 416,
    headers: { 'Content-Range': 'bytes */10', 'Content-Type': 'text/plain' },
    body: 'range not satisfiable',
  };
  const partial = (start: number, end: number, length: string) => ({
    status: 206,
    headers: {
      'Content-Type': MIME,
      'Accept-Ranges': 'bytes',
      'Content-Length': length,
      'Content-Range': `bytes ${start}-${end}/10`,
    },
    span: { start, end },
  });

  it.for([
    { name: 'absent header plans the full body', header: undefined, want: full },
    { name: 'closed range', header: 'bytes=2-5', want: partial(2, 5, '4') },
    { name: 'open-ended range', header: 'bytes=5-', want: partial(5, 9, '5') },
    { name: 'suffix range', header: 'bytes=-3', want: partial(7, 9, '3') },
    { name: 'clamped end', header: 'bytes=8-99', want: partial(8, 9, '2') },
    { name: 'reversed suffix past the size', header: 'bytes=-20', want: partial(0, 9, '10') },
    { name: 'unsatisfiable range', header: 'bytes=10-', want: notSatisfiable },
    { name: 'zero suffix', header: 'bytes=-0', want: notSatisfiable },
    { name: 'inverted range', header: 'bytes=5-2', want: notSatisfiable },
    { name: 'malformed range is ignored', header: 'bytes=abc', want: full },
    // RFC 7233 lets a server ignore the header; the parser reads no comma
    // lists, so multi-range requests fall back to the full body.
    { name: 'in-header multi-range is ignored', header: 'bytes=1-2,3-4', want: full },
    {
      name: 'the first header wins when several arrive',
      header: ['bytes=1-2', 'bytes=3-4'],
      want: partial(1, 2, '2'),
    },
  ])('$name', ({ header, want }) => {
    expect(rangePlan(header, SIZE, MIME)).toEqual(want);
  });

  it('carries the caller-provided mime type on body responses', () => {
    expect(rangePlan(undefined, SIZE, 'application/octet-stream').headers['Content-Type']).toBe(
      'application/octet-stream',
    );
  });
});
