// Config file discovery and layer resolution: the imperative side of the
// option precedence (CLI flags > config file > built-in defaults). The config
// file is discovered upward from the working directory unless --config names
// one. The vocabulary itself stays pure in src/config.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  normalizeOverrides,
  validateRenderConfig,
} from './config.js';
import type { ConfigOverrides, RenderConfig } from './config.js';

// NEO2_FLIGHTPATH_TILE_CACHE overrides the per-user cache directory.
export function defaultTileCache(): string {
  const override = process.env['NEO2_FLIGHTPATH_TILE_CACHE'];
  if (override) return path.resolve(override);
  const base = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'neo2-flightpath', 'tiles');
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
    // hud is an object; Partial spread replaces it wholesale, which is what
    // we want. The winner is copied so no resolved config shares mutable
    // state with DEFAULT_CONFIG or another layer.
    hud: { ...(cli.hud ?? fileCfg.hud ?? DEFAULT_CONFIG.hud) },
  };
}

function resolveConfigPaths(config: RenderConfig, cwd: string): RenderConfig {
  return {
    ...config,
    tileCache: path.resolve(cwd, config.tileCache || defaultTileCache()),
    outDir: config.outDir ? path.resolve(cwd, config.outDir) : null,
  };
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

  return { config: resolveConfigPaths(merged, cwd), configPath };
}
