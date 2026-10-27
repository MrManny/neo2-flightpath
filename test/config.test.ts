import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverConfigFile,
  loadConfigFile,
  parseHud,
  resolveConfig,
} from '../src/config.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2cfg-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('parseHud', () => {
  it('parses comma lists', () => {
    expect(parseHud('heading,alt')).toEqual({
      heading: true,
      alt: true,
      speed: false,
    });
  });

  it('parses none', () => {
    expect(parseHud('none')).toEqual({
      heading: false,
      alt: false,
      speed: false,
    });
  });

  it('rejects unknown components', () => {
    expect(() => parseHud('heading,bogus')).toThrow(/unknown --hud component/);
  });
});

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
    expect(config.width).toBe(640); // CLI wins
    expect(config.style).toBe('topo'); // file wins over default
    expect(config.height).toBe(768); // default survives
    expect(config.outDir).toBe(path.join(root, 'out')); // resolved
  });

  it('validates ranges', () => {
    expect(() => resolveConfig({ cli: { workers: 0 }, configPath: null })).toThrow(
      /workers/,
    );
    expect(() => resolveConfig({ cli: { width: 10 }, configPath: null })).toThrow(
      /at least 64/,
    );
    expect(() =>
      resolveConfig({ cli: { outSuffix: '' }, configPath: null }),
    ).toThrow(/out-suffix/);
  });
});
