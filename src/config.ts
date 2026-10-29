// The option vocabulary: the option types (Style, View, Capture, Preset,
// HudSpec), their defaults and the parsing/normalizing rules. Feature modules
// import them from here, and this module stays free of I/O so the app UI can
// share the vocabulary in its browser bundle. File discovery and the
// precedence of the config layers live in src/configfile.ts.

export type Style = 'satellite' | 'topo';
export type View = 'follow' | 'overview';
export type Capture = 'jpeg' | 'png';
export type Preset = 'medium' | 'veryfast';

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
  /** Empty = the per-user cache directory; resolveConfig fills it in. */
  tileCache: string;
  browser: string | null;
  skipExisting: boolean;
  recurse: boolean;
  json: boolean;
  quiet: boolean;
}

export type ConfigOverrides = Partial<RenderConfig>;

// Named bundles of panel knobs ("presets sit on top of the advanced knobs"):
// each one sets every look control so switching presets never leaves stale
// values behind. Export-side options are untouched.
export interface PanelPreset {
  id: string;
  label: string;
  overrides: ConfigOverrides;
}

export const PANEL_PRESETS: readonly PanelPreset[] = [
  {
    id: 'quick-render',
    label: 'Quick render',
    overrides: {
      style: 'satellite',
      view: 'follow',
      zoom: 0,
      zoomOut: 1,
      introSec: 0,
      outroSec: 0,
      hud: { heading: true, alt: false, speed: false },
    },
  },
  {
    id: 'topo-full-hud',
    label: 'Topo + full HUD',
    overrides: {
      style: 'topo',
      view: 'follow',
      zoom: 0,
      zoomOut: 1,
      introSec: 2,
      outroSec: 2,
      hud: { heading: true, alt: true, speed: true },
    },
  },
];

export const CONFIG_FILE_NAME = '.neo2flightpath.json';

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
  tileCache: '',
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

// The "alt hides when unavailable" rule, one home for the pipeline and the UI.
export function resolveHudSpec(hud: HudSpec, hasAltitude: boolean): HudSpec {
  return hud.alt && !hasAltitude ? { ...hud, alt: false } : hud;
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

// The negated comparisons are NaN-safe: they also reject NaN sneak-ins.
export function validateRenderConfig(config: RenderConfig): void {
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
