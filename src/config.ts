// config.ts - defaults, optional .neo2flightpath.json, merge and validation.
// Precedence: CLI flags > config file > built-in defaults. The config file is
// discovered upward from the working directory unless --config names one.

import fs from 'node:fs';
import path from 'node:path';

import { defaultTileCache } from './tiles.js';

export type Style = 'satellite' | 'topo';
export type View = 'follow' | 'overview';
export type Capture = 'jpeg' | 'png';
export type Preset = 'medium' | 'veryfast';
export type Trail = 'full' | 'incr';

export interface HudSpec {
  heading: boolean;
  alt: boolean;
  speed: boolean;
}

export interface RenderConfig {
  /** null = write output beside the source video. */
  outDir: string | null;
  outSuffix: string;
  width: number;
  height: number;
  style: Style;
  view: View;
  /** 0 = auto-fit to the track. */
  zoom: number;
  zoomOut: number;
  introSec: number;
  outroSec: number;
  hud: HudSpec;
  workers: number;
  capture: Capture;
  preset: Preset;
  trail: Trail;
  tileCache: string;
  browser: string | null;
  skipExisting: boolean;
  recurse: boolean;
  json: boolean;
  quiet: boolean;
}

export type ConfigOverrides = Partial<RenderConfig>;

export const CONFIG_FILE_NAME = '.neo2flightpath.json';

export const DEFAULT_CONFIG: RenderConfig = {
  outDir: null,
  outSuffix: '_map',
  width: 768,
  height: 768,
  style: 'satellite',
  view: 'follow',
  zoom: 0,
  zoomOut: 1,
  introSec: 2,
  outroSec: 2,
  hud: { heading: true, alt: false, speed: false },
  workers: 4,
  capture: 'jpeg',
  preset: 'medium',
  trail: 'full',
  tileCache: defaultTileCache(),
  browser: null,
  skipExisting: false,
  recurse: false,
  json: false,
  quiet: false,
};

const STYLE_VALUES: Style[] = ['satellite', 'topo'];
const VIEW_VALUES: View[] = ['follow', 'overview'];
const CAPTURE_VALUES: Capture[] = ['jpeg', 'png'];
const PRESET_VALUES: Preset[] = ['medium', 'veryfast'];
const TRAIL_VALUES: Trail[] = ['full', 'incr'];

// Parse a --hud list: comma list of heading,alt,speed - or 'none'.
export function parseHud(list: string): HudSpec {
  const hud: HudSpec = { heading: false, alt: false, speed: false };
  if (!list || list.toLowerCase() === 'none') return hud;
  for (const part of list
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    if (part === 'heading' || part === 'arrow') hud.heading = true;
    else if (part === 'alt' || part === 'altitude') hud.alt = true;
    else if (part === 'speed') hud.speed = true;
    else
      throw new Error(
        `unknown --hud component: ${part} (use heading,alt,speed or none)`,
      );
  }
  return hud;
}

function asNumber(value: unknown, name: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`invalid number for ${name}: ${String(value)}`);
  }
  return n;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid value for ${name}: ${String(value)}`);
  }
  return value;
}

function asBool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`invalid value for ${name}: ${String(value)}`);
  }
  return value;
}

function asEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`invalid value for ${name}: ${String(value)} (use ${allowed.join(' | ')})`);
  }
  return value as T;
}

function asNullableString(value: unknown, name: string): string | null {
  if (value === null || value === '') return null;
  return asString(value, name);
}

// Normalize one raw config object (config file or CLI values) into overrides.
export function normalizeOverrides(
  raw: Record<string, unknown>,
  origin: string,
): ConfigOverrides {
  const out: ConfigOverrides = {};
  const known = new Set([
    'outDir', 'outSuffix', 'width', 'height', 'style', 'view', 'zoom',
    'zoomOut', 'introSec', 'outroSec', 'hud', 'workers', 'capture', 'preset',
    'trail', 'tileCache', 'browser', 'skipExisting', 'recurse', 'json', 'quiet',
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`unknown config key ${key} in ${origin}`);
    const value = raw[key];
    if (value === undefined || value === null) continue;
    switch (key) {
      case 'outDir':
        out.outDir = asNullableString(value, `${origin}: outDir`);
        break;
      case 'outSuffix':
        out.outSuffix = asString(value, `${origin}: outSuffix`);
        break;
      case 'width':
      case 'height':
      case 'zoom':
      case 'zoomOut':
      case 'introSec':
      case 'outroSec':
      case 'workers':
        out[key] = asNumber(value, `${origin}: ${key}`);
        break;
      case 'style':
        out.style = asEnum(value, `${origin}: style`, STYLE_VALUES);
        break;
      case 'view':
        out.view = asEnum(value, `${origin}: view`, VIEW_VALUES);
        break;
      case 'capture':
        out.capture = asEnum(value, `${origin}: capture`, CAPTURE_VALUES);
        break;
      case 'preset':
        out.preset = asEnum(value, `${origin}: preset`, PRESET_VALUES);
        break;
      case 'trail':
        out.trail = asEnum(value, `${origin}: trail`, TRAIL_VALUES);
        break;
      case 'hud':
        out.hud = parseHud(asString(value, `${origin}: hud`));
        break;
      case 'tileCache':
        out.tileCache = asString(value, `${origin}: tileCache`);
        break;
      case 'browser':
        out.browser = asNullableString(value, `${origin}: browser`);
        break;
      case 'skipExisting':
      case 'recurse':
      case 'json':
      case 'quiet':
        out[key] = asBool(value, `${origin}: ${key}`);
        break;
    }
  }
  return out;
}

// Find a .neo2flightpath.json by walking up from startDir.
export function discoverConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfigFile(file: string): ConfigOverrides {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read config file ${file}: ${(e as Error).message}`, {
      cause: e,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `config file is not valid JSON: ${file}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`config file must contain a JSON object: ${file}`);
  }
  return normalizeOverrides(raw as Record<string, unknown>, file);
}

export interface ResolvedConfig {
  config: RenderConfig;
  configPath: string | null;
}

// Merge CLI overrides over the config file over the defaults; validate ranges.
export function resolveConfig(opts: {
  cli?: ConfigOverrides;
  configPath?: string | null;
  cwd?: string;
}): ResolvedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const configPath =
    opts.configPath != null
      ? path.resolve(cwd, opts.configPath)
      : discoverConfigFile(cwd);
  const fileCfg = configPath ? loadConfigFile(configPath) : {};
  const merged: RenderConfig = {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...(opts.cli ?? {}),
    // hud is an object; Partial spread replaces it wholesale, which is what we want.
    hud: opts.cli?.hud ?? fileCfg.hud ?? DEFAULT_CONFIG.hud,
  };

  if (!(merged.width >= 64) || !(merged.height >= 64)) {
    throw new Error('width and height must be at least 64');
  }
  if (!Number.isInteger(merged.workers) || merged.workers < 1) {
    throw new Error('workers must be a positive integer');
  }
  if (!(merged.zoom >= 0)) throw new Error('zoom must be >= 0 (0 = auto-fit)');
  if (!(merged.zoomOut >= 0)) throw new Error('zoom-out must be >= 0');
  if (!(merged.introSec >= 0) || !(merged.outroSec >= 0)) {
    throw new Error('intro-sec and outro-sec must be >= 0');
  }
  if (!merged.outSuffix) throw new Error('out-suffix must not be empty');
  merged.tileCache = path.resolve(cwd, merged.tileCache);
  if (merged.outDir) merged.outDir = path.resolve(cwd, merged.outDir);

  return { config: merged, configPath };
}
