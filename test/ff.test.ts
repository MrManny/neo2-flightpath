import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireTools } from '../src/ff.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}));

beforeEach(() => {
  mocks.execFile.mockReset();
});

describe('requireTools', () => {
  it('resolves when both tools respond', async () => {
    mocks.execFile.mockImplementation(
      (
        _tool: string,
        _args: string[],
        _opts: unknown,
        cb: (e: null, result: { stdout: string; stderr: string }) => void,
      ) => cb(null, { stdout: 'ok', stderr: '' }),
    );
    await expect(requireTools()).resolves.toBeUndefined();
  });

  it.each(['ffmpeg', 'ffprobe'])('keeps the %s failure as the cause', async (tool) => {
    const failure = new Error(`spawn ${tool} ENOENT`);
    mocks.execFile.mockImplementation(
      (
        running: string,
        _args: string[],
        _opts: unknown,
        cb: (e: Error | null, result?: unknown) => void,
      ) => (running === tool ? cb(failure) : cb(null, { stdout: 'ok', stderr: '' })),
    );
    const err = await requireTools().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toContain(`${tool} is required but was not found on PATH`);
    expect(err?.cause).toBe(failure);
  });
});
