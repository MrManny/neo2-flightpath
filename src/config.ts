// Precedence: CLI flags > config file > built-in defaults. The config file is
// discovered upward from the working directory unless --config names one.
//
// This module is the vocabulary home for the option types (Style, View,
// Capture, Preset, Trail, HudSpec); feature modules import them from here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// NEO2_FLIGHTPATH_TILE_CACHE overrides the per-user cache directory.
export function defaultTileCache(): string {
  const override = process.env['NEO2_FLIGHTPATH_TILE_CACHE'];
  if (override) return path.resolve(override);
  const base = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'neo2-flightpath', 'tiles');
}

export const DEFAULT_CONFIG: RenderConfig = {
  outDir: 'out',
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

// One normalizer per config key: validation, conversion and the "known keys"
// whitelist all live in this single table (previously three parallel lists).
type OverrideNormalizer = (value: unknown, name: string) => ConfigOverrides;

const OVERRIDE_NORMALIZERS: Record<keyof RenderConfig, OverrideNormalizer> = {
  outDir: (v, name) => ({ outDir: asNullableString(v, name) }),
  outSuffix: (v, name) => ({ outSuffix: asString(v, name) }),
  width: (v, name) => ({ width: asNumber(v, name) }),
  height: (v, name) => ({ height: asNumber(v, name) }),
  style: (v, name) => ({ style: asEnum(v, name, STYLE_VALUES) }),
  view: (v, name) => ({ view: asEnum(v, name, VIEW_VALUES) }),
  zoom: (v, name) => ({ zoom: asNumber(v, name) }),
  zoomOut: (v, name) => ({ zoomOut: asNumber(v, name) }),
  introSec: (v, name) => ({ introSec: asNumber(v, name) }),
  outroSec: (v, name) => ({ outroSec: asNumber(v, name) }),
  hud: (v, name) => ({ hud: parseHud(asString(v, name)) }),
  workers: (v, name) => ({ workers: asNumber(v, name) }),
  capture: (v, name) => ({ capture: asEnum(v, name, CAPTURE_VALUES) }),
  preset: (v, name) => ({ preset: asEnum(v, name, PRESET_VALUES) }),
  trail: (v, name) => ({ trail: asEnum(v, name, TRAIL_VALUES) }),
  tileCache: (v, name) => ({ tileCache: asString(v, name) }),
  browser: (v, name) => ({ browser: asNullableString(v, name) }),
  skipExisting: (v, name) => ({ skipExisting: asBool(v, name) }),
  recurse: (v, name) => ({ recurse: asBool(v, name) }),
  json: (v, name) => ({ json: asBool(v, name) }),
  quiet: (v, name) => ({ quiet: asBool(v, name) }),
};

export function normalizeOverrides(
  raw: Record<string, unknown>,
  origin: string,
): ConfigOverrides {
  const out: ConfigOverrides = {};
  for (const key of Object.keys(raw)) {
    const normalize = Object.hasOwn(OVERRIDE_NORMALIZERS, key)
      ? OVERRIDE_NORMALIZERS[key as keyof RenderConfig]
      : null;
    if (!normalize) throw new Error(`unknown config key ${key} in ${origin}`);
    const value = raw[key];
    if (value === undefined || value === null) continue;
    Object.assign(out, normalize(value, `${origin}: ${key}`));
  }
  return out;
}

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

function mergeConfigLayers(
  fileCfg: ConfigOverrides,
  cli: ConfigOverrides,
): RenderConfig {
  return {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...cli,
    // hud is an object; Partial spread replaces it wholesale, which is what we want.
    hud: cli.hud ?? fileCfg.hud ?? DEFAULT_CONFIG.hud,
  };
}

// The negated comparisons are NaN-safe: they also reject NaN sneak-ins.
function validateRenderConfig(config: RenderConfig): void {
  if (!(config.width >= 64) || !(config.height >= 64)) {
    throw new Error('width and height must be at least 64');
  }
  if (!Number.isInteger(config.workers) || config.workers < 1) {
    throw new Error('workers must be a positive integer');
  }
  if (!(config.zoom >= 0)) throw new Error('zoom must be >= 0 (0 = auto-fit)');
  if (!(config.zoomOut >= 0)) throw new Error('zoom-out must be >= 0');
  if (!(config.introSec >= 0) || !(config.outroSec >= 0)) {
    throw new Error('intro-sec and outro-sec must be >= 0');
  }
  if (!config.outSuffix) throw new Error('out-suffix must not be empty');
}

function resolveConfigPaths(config: RenderConfig, cwd: string): void {
  config.tileCache = path.resolve(cwd, config.tileCache);
  if (config.outDir) config.outDir = path.resolve(cwd, config.outDir);
}

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
  const merged = mergeConfigLayers(fileCfg, opts.cli ?? {});

  validateRenderConfig(merged);
  resolveConfigPaths(merged, cwd);

  return { config: merged, configPath };
}
