import { describe, expect, it, vi } from 'vitest';

import { createAppSession, frameExactDuration } from '../src/appsession.js';
import type { PrepareUiSession, UiSession } from '../src/appsession.js';
import type { RenderConfig } from '../src/config.js';
import type { PrepareProgress } from '../src/run.js';
import { cleanupTmpDirs, probeFixture, tmpDir } from './fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach } from 'vitest';

const CONFIG = {} as RenderConfig;
const SESSION = { scene: {}, video: {} } as unknown as UiSession;

const PROBE = probeFixture({
  fps: { num: 30000, den: 1001, value: 29.97, str: '30000/1001' },
  frames: 300,
  durationSec: 10.01,
  width: 1920,
  height: 1080,
});

describe('frameExactDuration', () => {
  it('takes the duration from the frame-exact count and rate', () => {
    expect(frameExactDuration(PROBE)).toBe(300 / 29.97);
  });

  it('ignores the container duration the probe reports alongside', () => {
    const probe = {
      ...PROBE,
      fps: { num: 30, den: 1, value: 30, str: '30' },
      frames: 90,
    };
    expect(frameExactDuration(probe)).toBe(3);
    expect(probe.durationSec).not.toBe(3);
  });
});

function mp4(name = 'clip.mp4'): string {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, Buffer.from('video'));
  return file;
}

afterEach(cleanupTmpDirs);

describe('createAppSession', () => {
  it('prepares a picked recording and holds its session', async () => {
    const file = mp4();
    const prepare = vi.fn(async (): Promise<UiSession> => SESSION);
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });

    expect(await session.pick()).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(file, CONFIG, expect.any(Function), expect.any(Function));
    expect(session.getSession()).toBe(SESSION);
    expect(session.videoPath()).toBe(file);
  });

  it('reports a canceled dialog', async () => {
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
    });
    expect(await session.pick()).toEqual({ ok: false, canceled: true });
    expect(session.getSession()).toBeNull();
  });

  it('rejects non-mp4 picks', async () => {
    const file = path.join(tmpDir(), 'clip.mov');
    fs.writeFileSync(file, Buffer.from('video'));
    const prepare = vi.fn();
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });
    const result = await session.pick();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a readable .mp4 file');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects a missing file', async () => {
    const missing = path.join(tmpDir(), 'gone.mp4');
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => missing,
      prepare: vi.fn(),
    });
    expect((await session.pick()).error).toContain('not a readable .mp4 file');
  });

  it('surfaces preparation failures and keeps no session', async () => {
    const file = mp4();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => file,
      prepare: vi.fn(async () => {
        throw new Error('probe failed');
      }),
    });
    const result = await session.pick();
    expect(result).toEqual({ ok: false, error: 'probe failed' });
    expect(session.getSession()).toBeNull();
    expect(session.videoPath()).toBeNull();
  });

  it('keeps the previous session when a new pick fails', async () => {
    const first = mp4('first.mp4');
    const prepare = vi.fn(async (): Promise<UiSession> => SESSION);
    let pickFile = async (): Promise<string | null> => first;
    const session = createAppSession({ config: CONFIG, pickFile: () => pickFile(), prepare });
    await session.pick();
    pickFile = async (): Promise<string | null> => null;
    await session.pick();
    expect(session.getSession()).toBe(SESSION);
    expect(session.videoPath()).toBe(first);
  });

  it('refuses a pick while another is in progress', async () => {
    const file = mp4();
    let release: ((value: UiSession) => void) | null = null;
    const prepare = vi.fn(
      () =>
        new Promise<UiSession>((resolve) => {
          release = resolve;
        }),
    );
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare });

    const first = session.pick();
    const second = await session.pick();
    expect(second).toEqual({ ok: false, error: 'a pick is already in progress' });
    if (release) release(SESSION);
    expect(await first).toEqual({ ok: true });
  });
});

describe('createAppSession onPreparing hook', () => {
  it('fires once with the picked path, before preparation starts', async () => {
    const file = mp4();
    const order: string[] = [];
    const onPreparing = vi.fn((videoPath: string) => {
      order.push(`preparing ${videoPath}`);
    });
    const prepare = vi.fn(async (): Promise<UiSession> => {
      order.push('prepare');
      return SESSION;
    });
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare, onPreparing });

    expect(await session.pick()).toEqual({ ok: true });
    expect(onPreparing).toHaveBeenCalledTimes(1);
    expect(order).toEqual([`preparing ${file}`, 'prepare']);
  });

  it('stays silent when the dialog is canceled', async () => {
    const onPreparing = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
      onPreparing,
    });
    expect(await session.pick()).toEqual({ ok: false, canceled: true });
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it('stays silent when the dialog itself fails', async () => {
    const onPreparing = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => {
        throw new Error('dialog unavailable');
      },
      prepare: vi.fn(),
      onPreparing,
    });
    expect(await session.pick()).toEqual({ ok: false, error: 'dialog unavailable' });
    expect(onPreparing).not.toHaveBeenCalled();
  });

  it('stays silent for a file that is not a readable recording', async () => {
    const file = path.join(tmpDir(), 'clip.mov');
    fs.writeFileSync(file, Buffer.from('video'));
    const onPreparing = vi.fn();
    const prepare = vi.fn();
    const session = createAppSession({ config: CONFIG, pickFile: async () => file, prepare, onPreparing });
    expect((await session.pick()).ok).toBe(false);
    expect(onPreparing).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('createAppSession onPrepareProgress hook', () => {
  const reported: PrepareProgress = {
    stage: 'tiles',
    done: 3,
    total: 51,
    tilesDone: 0,
    tilesTotal: 48,
  };

  it('hands the hook to preparation and forwards its reports', async () => {
    const file = mp4();
    const onPrepareProgress = vi.fn();
    const prepare = vi.fn<PrepareUiSession>(async (_file, _config, _log, onProgress) => {
      onProgress?.(reported);
      return SESSION;
    });
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => file,
      prepare,
      onPrepareProgress,
    });

    expect(await session.pick()).toEqual({ ok: true });
    expect(prepare).toHaveBeenCalledWith(file, CONFIG, expect.any(Function), onPrepareProgress);
    expect(onPrepareProgress).toHaveBeenCalledTimes(1);
    expect(onPrepareProgress).toHaveBeenCalledWith(reported);
  });

  it('stays silent when the pick is rejected before preparation', async () => {
    const onPrepareProgress = vi.fn();
    const session = createAppSession({
      config: CONFIG,
      pickFile: async () => null,
      prepare: vi.fn(),
      onPrepareProgress,
    });
    expect(await session.pick()).toEqual({ ok: false, canceled: true });
    expect(onPrepareProgress).not.toHaveBeenCalled();
  });
});
