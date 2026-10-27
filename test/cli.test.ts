import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/cli.js';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

describe('parseCliArgs', () => {
  it('applies defaults for a bare invocation', () => {
    const { inputs, cli } = parseCliArgs(['clip.mp4']);
    expect(inputs).toEqual(['clip.mp4']);
    expect(cli.style).toBe('satellite');
    expect(cli.view).toBe('follow');
    expect(cli.width).toBe(768);
    expect(cli.height).toBe(768);
    expect(cli.outSuffix).toBe('_map');
    expect(cli.capture).toBe('jpeg');
    expect(cli.hud).toEqual({ heading: true, alt: false, speed: false });
    expect(cli.skipExisting).toBe(false);
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
});
