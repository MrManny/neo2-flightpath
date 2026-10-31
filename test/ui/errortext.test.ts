import { describe, expect, it } from 'vitest';

import { describeError } from '../../ui/lib/errortext.js';

describe.for([
  {
    code: 'EEXIST',
    raw: "EEXIST: file already exists, mkdir 'E:\\exports\\blocked-folder'",
    name: 'blocked-folder',
    lead: 'A file named "blocked-folder" is in the way.',
  },
  {
    code: 'ENOENT',
    raw: "ENOENT: no such file or directory, open 'E:\\clips\\gone.mp4'",
    name: 'gone.mp4',
    lead: '"gone.mp4" was not found.',
  },
  {
    code: 'EACCES',
    raw: "EACCES: permission denied, open 'E:\\locked\\out.mp4'",
    name: 'out.mp4',
    lead: 'Access to "out.mp4" was denied.',
  },
  {
    code: 'EPERM',
    raw: "EPERM: operation not permitted, unlink 'E:\\locked\\out.mp4'",
    name: 'out.mp4',
    lead: 'Access to "out.mp4" was denied.',
  },
  {
    code: 'EBUSY',
    raw: "EBUSY: resource busy or locked, rename 'E:\\exports\\a.partial.mp4'",
    name: 'a.partial.mp4',
    lead: '"a.partial.mp4" is in use by another program.',
  },
  {
    code: 'EISDIR',
    raw: "EISDIR: illegal operation on a directory, open 'E:\\exports'",
    name: 'exports',
    lead: '"exports" is a folder, not a file.',
  },
])('Node $code', ({ raw, name, lead }) => {
  it('rewrites the message into a sentence that names the file', () => {
    const { text, technical } = describeError(raw);
    expect(text).toContain(lead);
    expect(text).toContain(name);
    expect(text).not.toMatch(/^E[A-Z]+:/);
    expect(technical).toBe(raw);
  });
});

describe('Node messages without a path', () => {
  it('still gives an actionable sentence', () => {
    expect(describeError('EEXIST: file already exists, mkdir')).toEqual({
      text: 'A file is in the way. Choose another folder or file name.',
      technical: 'EEXIST: file already exists, mkdir',
    });
  });

  it('names no file for a full disk', () => {
    const raw = 'ENOSPC: no space left on device, write';
    expect(describeError(raw)).toEqual({
      text: 'The disk is full. Free some space or choose another drive.',
      technical: raw,
    });
  });
});

describe.for([
  { raw: 'no recording loaded', text: 'No recording is loaded. Open a recording first.' },
  {
    raw: 'an export is already running',
    text: 'An export is already running. Wait for it to finish or cancel it.',
  },
  { raw: 'export could not start', text: 'The export could not start. Try again.' },
  { raw: 'export could not be canceled', text: 'The export could not be canceled. Try again.' },
  {
    raw: 'the output must not overwrite the source recording',
    text: 'The export would replace the source recording. Choose another file name.',
  },
  { raw: 'app bridge unavailable', text: 'The app backend is not available. Restart the app.' },
  { raw: 'unknown error', text: 'Something went wrong. Try again.' },
  {
    raw: 'output verification failed: got 120 frames @ 30, expected 121 @ 60000/1001',
    text: 'The finished file does not match the recording frame count or frame rate.',
  },
  {
    raw: 'could not determine the frame rate of the video',
    text: "This video's frame rate could not be read.",
  },
])('app message "$raw"', ({ raw, text }) => {
  it('rewrites it and keeps the original as technical details', () => {
    expect(describeError(raw)).toEqual({ text, technical: raw });
  });
});

describe('app messages that carry a path', () => {
  it('names only the file for an unreadable recording', () => {
    const raw = 'not a readable .mp4 file: C:\\Windows\\win.ini';
    expect(describeError(raw)).toEqual({
      text: '"win.ini" is not a readable .mp4 recording.',
      technical: raw,
    });
  });

  it('points to the kept render when the finished file cannot replace the destination', () => {
    const raw =
      'could not replace E:\\exports\\a.mp4: EBUSY: resource busy or locked, rename ' +
      "'E:\\exports\\a.partial.mp4' -> 'E:\\exports\\a.mp4' " +
      '(the finished render is at E:\\exports\\a.partial.mp4)';
    const { text, technical } = describeError(raw);
    expect(text).toContain('The render is kept at E:\\exports\\a.partial.mp4.');
    expect(technical).toBe(raw);
  });
});

describe.for([{ message: 'boom' }, { message: 'Disk on fire: 42' }, { message: '' }])(
  'unknown message "$message"',
  ({ message }) => {
    it('passes through unchanged with no technical details', () => {
      expect(describeError(message)).toEqual({ text: message, technical: null });
    });
  },
);
