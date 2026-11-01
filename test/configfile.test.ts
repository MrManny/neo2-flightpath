import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultTileCache,
  discoverConfigFile,
  loadConfigFile,
  resolveConfig,
} from '../src/configfile.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

describe('discoverConfigFile', () => {
  it('walks up to the config file', () => {
    const root = tmpDir();
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(root, '.neo2flightpath.json');
    fs.writeFileSync(file, '{}');
    expect(discoverConfigFile(nested)).toBe(file);
    expect(discoverConfigFile(os.tmpdir())).toBeNull();
  });
});

describe('loadConfigFile', () => {
  it('rejects unknown keys', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"bogus": 1}');
    expect(() => loadConfigFile(file)).toThrow(/unknown config key/);
  });

  it('rejects the removed trail key', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{"trail": "incr"}');
    expect(() => loadConfigFile(file)).toThrow(/unknown config key/);
  });

  it('rejects invalid JSON', () => {
    const file = path.join(tmpDir(), 'c.json');
    fs.writeFileSync(file, '{oops');
    expect(() => loadConfigFile(file)).toThrow(/not valid JSON/);
  });
});

describe('resolveConfig', () => {
  it('applies precedence CLI > file > defaults and resolves paths', () => {
    const root = tmpDir();
    const file = path.join(root, '.neo2flightpath.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ width: 320, style: 'topo', outDir: 'out' }),
    );
    const { config, configPath } = resolveConfig({
      cli: { width: 640 },
      configPath: file,
      cwd: root,
    });
    expect(configPath).toBe(file);
    expect(config.width).toBe(640);
    expect(config.style).toBe('topo');
    expect(config.height).toBe(768); // default survives
    expect(config.outDir).toBe(path.join(root, 'out')); // resolved against the working directory
  });

  it('fills the per-user tile cache when no layer sets one', () => {
    const { config } = resolveConfig({ configPath: null, cwd: tmpDir() });
    expect(config.tileCache).toBe(defaultTileCache());
  });

  it('validates ranges', () => {
    expect(() => resolveConfig({ cli: { workers: 0 }, configPath: null, cwd: tmpDir() })).toThrow(
      /workers/,
    );
    expect(() => resolveConfig({ cli: { width: 10 }, configPath: null, cwd: tmpDir() })).toThrow(
      /at least 64/,
    );
    expect(() =>
      resolveConfig({ cli: { outSuffix: '' }, configPath: null, cwd: tmpDir() }),
    ).toThrow(/out-suffix/);
  });

  it('normalizes odd dimensions to the effective even canvas', () => {
    const root = tmpDir();
    const file = path.join(root, '.neo2flightpath.json');
    fs.writeFileSync(file, '{}');
    const { config } = resolveConfig({
      cli: { width: 767, height: 501 },
      configPath: file,
      cwd: root,
    });
    expect(config.width).toBe(766);
    expect(config.height).toBe(500);
  });

  it('keeps hud state private to each resolved config', () => {
    const root = tmpDir();
    const file = path.join(root, '.neo2flightpath.json');
    fs.writeFileSync(file, '{}');

    const { config: first } = resolveConfig({ configPath: file, cwd: root });
    expect(first.hud).not.toBe(DEFAULT_CONFIG.hud);
    first.hud.alt = true; // in-place edit must not leak anywhere else

    const { config: second } = resolveConfig({ configPath: file, cwd: root });
    expect(second.hud).toEqual(DEFAULT_CONFIG.hud);
    expect(DEFAULT_CONFIG.hud.alt).toBe(false);
    expect(first.hud.alt).toBe(true);
  });
});
