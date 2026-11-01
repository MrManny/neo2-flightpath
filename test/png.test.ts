import { describe, expect, it } from 'vitest';

import { solidPng } from '../src/png.js';

describe('solidPng', () => {
  it('writes a valid PNG signature and 256x256 IHDR', () => {
    const buf = solidPng('#2a2f38');
    expect([...buf.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(buf.readUInt32BE(16)).toBe(256); // IHDR width
    expect(buf.readUInt32BE(20)).toBe(256); // IHDR height
  });
});
