import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverConfigFile,
  loadConfigFile,
  PANEL_PRESETS,
  parseHud,
  resolveConfig,
  resolveHudSpec,
} from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

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
});

describe('resolveHudSpec', () => {
  it('keeps the alt chip when the telemetry has altitude', () => {
    const hud = { heading: true, alt: true, speed: false };
    expect(resolveHudSpec(hud, true)).toEqual(hud);
  });

  it('drops the alt chip when the telemetry has no altitude', () => {
    expect(
      resolveHudSpec({ heading: true, alt: true, speed: true }, false),
    ).toEqual({ heading: true, alt: false, speed: true });
  });

  it('leaves the other chips untouched when alt is already off', () => {
    const hud = { heading: true, alt: false, speed: true };
    expect(resolveHudSpec(hud, false)).toEqual(hud);
  });
});

describe('PANEL_PRESETS', () => {
  const PANEL_KEYS: Array<keyof RenderConfig> = [
    'style',
    'view',
    'zoom',
    'zoomOut',
    'introSec',
    'outroSec',
    'hud',
  ];

  it('names the two documented presets', () => {
    expect(PANEL_PRESETS.map((p) => p.label)).toEqual([
      'Quick render',
      'Topo + full HUD',
    ]);
  });

  it('has unique ids', () => {
    const ids = PANEL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bundles every panel knob so no stale values survive a switch', () => {
    for (const preset of PANEL_PRESETS) {
      for (const key of PANEL_KEYS) {
        expect(preset.overrides).toHaveProperty(key);
      }
    }
  });

  it('resolves each bundle to a valid config', () => {
    for (const preset of PANEL_PRESETS) {
      const { config } = resolveConfig({
        cli: preset.overrides,
        configPath: null,
        cwd: tmpDir(),
      });
      expect(config.zoom).toBeGreaterThanOrEqual(0);
      expect(config.introSec).toBeGreaterThanOrEqual(0);
      expect(config.outroSec).toBeGreaterThanOrEqual(0);
    }
  });
});
