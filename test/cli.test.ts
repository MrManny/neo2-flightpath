import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli.js';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2cli-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

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

  it('rejects invalid numbers', () => {
    expect(() => parseCliArgs(['x.mp4', '--width', 'wide'])).toThrow(
      /invalid number/,
    );
  });

  it('does not clobber defaults with absent optional flags', () => {
    const { cli } = parseCliArgs(['clip.mp4']);
    const { config } = resolveConfig({ cli, configPath: null, cwd: os.tmpdir() });
    expect(config.tileCache).toBe(DEFAULT_CONFIG.tileCache);
    expect(config.outDir).toBeNull();
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
    // keys the file does not set keep the built-in defaults
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
