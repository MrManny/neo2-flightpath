import { describe, expect, it } from 'vitest';

import { formatFrameRate } from '../../ui/lib/framerate.js';

describe.each([
  { rate: '60000/1001', text: '59.94 fps' },
  { rate: '30000/1001', text: '29.97 fps' },
  { rate: '24000/1001', text: '23.98 fps' },
  { rate: '30', text: '30 fps' },
  { rate: '25/1', text: '25 fps' },
])('formatFrameRate($rate)', ({ rate, text }) => {
  it('reads the rate as decimal fps', () => {
    expect(formatFrameRate(rate)).toBe(text);
  });
});

describe.each(['0/0', '30/0', '', 'abc'])('formatFrameRate(%j) without a usable rate', (rate) => {
  it('passes the raw value through unchanged', () => {
    expect(formatFrameRate(rate)).toBe(rate);
  });
});
