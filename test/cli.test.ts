import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, parseCliArgs } from '../src/cli.js';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('parseCliArgs', () => {
  it('forwards only the flags actually set (bare invocation adds nothing)', () => {
    const { inputs, cli } = parseCliArgs(['clip.mp4']);
    expect(inputs).toEqual(['clip.mp4']);
    // Commander's built-in defaults must not leak into the override layer:
    // they would always win over the config file.
    expect(cli).toEqual({});
  });

  it('parses flags and multiple inputs', () => {
    const { inputs, cli, configPath } = parseCliArgs([
      'a.mp4',
      'folder',
      '--style', 'topo',
      '--width', '1024',
      '--height', '512',
      '--hud', 'heading,alt,speed',
      '--skip-existing',
      '--recurse',
      '--json',
      '--config', 'my.json',
    ]);
    expect(inputs).toEqual(['a.mp4', 'folder']);
    expect(cli.style).toBe('topo');
    expect(cli.width).toBe(1024);
    expect(cli.height).toBe(512);
    expect(cli.hud).toEqual({ heading: true, alt: true, speed: true });
    expect(cli.skipExisting).toBe(true);
    expect(cli.recurse).toBe(true);
    expect(cli.json).toBe(true);
    expect(configPath).toBe('my.json');
  });

  it('rejects invalid enum values', () => {
    expect(() => parseCliArgs(['x.mp4', '--style', 'nope'])).toThrow();
    expect(() => parseCliArgs(['x.mp4', '--capture', 'canvas'])).toThrow();
  });

  it('rejects the removed --trail flag', () => {
    expect(() => parseCliArgs(['x.mp4', '--trail', 'full'])).toThrow(/unknown option/);
  });

  it('rejects invalid numbers', () => {
    expect(() => parseCliArgs(['x.mp4', '--width', 'wide'])).toThrow(
      /invalid number/,
    );
  });

  it('does not clobber defaults with absent optional flags', () => {
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: null, cwd: os.tmpdir() });
    expect(config.tileCache).toBe(DEFAULT_CONFIG.tileCache);
    // default outDir is 'out', resolved against the working directory
    expect(config.outDir).toBe(path.resolve(os.tmpdir(), 'out'));
    expect(config.browser).toBeNull();
  });

  it('lets config-file values win over defaults on a bare invocation', () => {
    const dir = tmpDir();
    const cfgPath = path.join(dir, '.neo2flightpath.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        width: 320,
        style: 'topo',
        skipExisting: true,
        outSuffix: '_flight',
      }),
    );
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: cfgPath, cwd: dir });
    expect(config.width).toBe(320);
    expect(config.style).toBe('topo');
    expect(config.skipExisting).toBe(true);
    expect(config.outSuffix).toBe('_flight');
    expect(config.height).toBe(DEFAULT_CONFIG.height);
    expect(config.hud).toEqual(DEFAULT_CONFIG.hud);
  });

  it('lets explicitly set CLI flags win over the config file', () => {
    const dir = tmpDir();
    const cfgPath = path.join(dir, '.neo2flightpath.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ width: 320, style: 'topo', skipExisting: true }),
    );
    const { cli } = parseCliArgs([
      'clip.mp4', '--width', '512', '--style', 'satellite',
    ]);
    const { config } = resolveConfig({ cli, configPath: cfgPath, cwd: dir });
    expect(config.width).toBe(512);
    expect(config.style).toBe('satellite');
    // flags not passed still take the file's values
    expect(config.skipExisting).toBe(true);
  });
});

describe('main tracing wiring', () => {
  const savedExitCode = process.exitCode;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = savedExitCode;
  });

  it('fails fast on an unsupported protocol before touching the pipeline', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:4318');
    vi.stubEnv('OTEL_EXPORTER_OTLP_PROTOCOL', 'grpc');
    // An explicit empty config keeps ambient config discovery out of the test.
    const configPath = path.join(tmpDir(), 'config.json');
    fs.writeFileSync(configPath, '{}');
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    await main(['node', 'neo2-flightpath', 'clip.mp4', '--config', configPath]);
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain(
      '[neo2-flightpath] ERROR: unsupported OTEL_EXPORTER_OTLP_PROTOCOL: grpc (only http/protobuf is supported)',
    );
    expect(process.exitCode).toBe(1);
  });

  async function mainWithMocks(opts: { shutdownError?: Error }) {
    const shutdowns = { count: 0 };
    vi.resetModules();
    vi.doMock('../src/tracing.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/tracing.js')>();
      return {
        ...actual,
        createTracing: async () => ({
          enabled: true,
          tracer: actual.NOOP_TRACER,
          flush: async () => {},
          shutdown: async () => {
            shutdowns.count++;
            if (opts.shutdownError) throw opts.shutdownError;
          },
        }),
      };
    });
    vi.doMock('../src/ff.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/ff.js')>()),
      requireTools: async () => {},
    }));
    vi.doMock('../src/inputs.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/inputs.js')>()),
      collectRecordings: () => [path.join('clips', 'clip.mp4')],
    }));
    vi.doMock('../src/run.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/run.js')>()),
      runBatch: async () => {
        throw new Error('batch exploded');
      },
    }));
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const configPath = path.join(tmpDir(), 'config.json');
      fs.writeFileSync(configPath, '{}');
      const { main: mockedMain } = await import('../src/cli.js');
      await mockedMain([
        'node', 'neo2-flightpath', 'clip.mp4', '--out-dir', tmpDir(),
        '--config', configPath,
      ]);
      return {
        stderr: stderr.mock.calls.map((c) => String(c[0])).join(''),
        shutdowns: shutdowns.count,
      };
    } finally {
      vi.doUnmock('../src/tracing.js');
      vi.doUnmock('../src/ff.js');
      vi.doUnmock('../src/inputs.js');
      vi.doUnmock('../src/run.js');
      vi.resetModules();
    }
  }

  it('logs the enabled tracer and shuts tracing down when the batch fails', async () => {
    const { stderr, shutdowns } = await mainWithMocks({});
    expect(stderr).toContain('tracing: enabled (OTLP/HTTP protobuf)');
    expect(stderr).toContain('[neo2-flightpath] ERROR: batch exploded');
    expect(shutdowns).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it('reports a shutdown failure without masking the real error', async () => {
    const { stderr, shutdowns } = await mainWithMocks({
      shutdownError: new Error('shutdown exploded'),
    });
    expect(stderr).toContain('[neo2-flightpath] ERROR: batch exploded');
    expect(stderr).toContain(
      'warning: tracing shutdown failed: shutdown exploded',
    );
    expect(shutdowns).toBe(1);
    expect(process.exitCode).toBe(1);
  });
});
