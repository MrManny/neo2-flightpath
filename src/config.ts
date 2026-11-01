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

export const CONFIG_FILE_NAME = '.neo2flightpath.json';

export const STYLE_VALUES: readonly Style[] = ['satellite', 'topo'];
export const VIEW_VALUES: readonly View[] = ['follow', 'overview'];
const CAPTURE_VALUES: Capture[] = ['jpeg', 'png'];
const PRESET_VALUES: Preset[] = ['medium', 'veryfast'];

// The normalizer column of the option key table: validation and conversion for
// one key, taking the raw value and an error-context name.
type OverrideNormalizer = (value: unknown, name: string) => ConfigOverrides;

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
export function resolveHudSpec(hud: HudSpec, hasAlt: boolean): HudSpec {
  return hud.alt && !hasAlt ? { ...hud, alt: false } : hud;
}

// What "unavailable" means for the rule above: no altitude sample at all in
// the telemetry.
export function hasAltitude(alt: readonly (number | null)[]): boolean {
  return alt.some((a) => a !== null);
}

// The CLI-string form of a HUD spec ("none" when no chip is on), the inverse
// of parseHud.
export function formatHud(hud: HudSpec): string {
  const parts: string[] = [];
  if (hud.heading) parts.push('heading');
  if (hud.alt) parts.push('alt');
  if (hud.speed) parts.push('speed');
  return parts.length ? parts.join(',') : 'none';
}

export function asNumber(value: unknown, name: string): number {
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
  allowed: readonly T[],
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

// How one option appears on the command line: the flags (with any value
// placeholder), the help text, and the accepted choices for enum flags.
interface CliOptionSpec {
  flags: string;
  help: string;
  choices?: readonly string[];
}

// One row per config key: the key name, how the CLI spells it, the single
// default, and the normalizer. This is the option vocabulary's one table: the
// CLI's commander options and its override collection, the config-file layer
// and DEFAULT_CONFIG are all derived from it, so adding an option is one edit.
export interface ConfigOption<K extends keyof RenderConfig = keyof RenderConfig> {
  key: K;
  cli: CliOptionSpec;
  default: RenderConfig[K];
  normalize: OverrideNormalizer;
}

export const CONFIG_OPTIONS: readonly ConfigOption[] = [
  {
    key: 'outDir',
    cli: { flags: '--out-dir <dir>', help: 'output folder' },
    default: 'out',
    normalize: (v, name) => ({ outDir: asNullableString(v, name) }),
  },
  {
    key: 'outSuffix',
    cli: { flags: '--out-suffix <suffix>', help: 'output name = <basename><suffix>.mp4' },
    default: '_map',
    normalize: (v, name) => ({ outSuffix: asString(v, name) }),
  },
  {
    key: 'width',
    cli: { flags: '--width <px>', help: 'canvas width in pixels (rounded down to even)' },
    default: 768,
    normalize: (v, name) => ({ width: asNumber(v, name) }),
  },
  {
    key: 'height',
    cli: { flags: '--height <px>', help: 'canvas height in pixels (rounded down to even)' },
    default: 768,
    normalize: (v, name) => ({ height: asNumber(v, name) }),
  },
  {
    key: 'style',
    cli: { flags: '--style <name>', help: 'map look', choices: STYLE_VALUES },
    default: 'satellite',
    normalize: (v, name) => ({ style: asEnum(v, name, STYLE_VALUES) }),
  },
  {
    key: 'view',
    cli: {
      flags: '--view <mode>',
      help:
        'follow: drone stays centered and the map slides under it; overview: static whole-track map',
      choices: VIEW_VALUES,
    },
    default: 'follow',
    normalize: (v, name) => ({ view: asEnum(v, name, VIEW_VALUES) }),
  },
  {
    key: 'zoom',
    cli: { flags: '--zoom <n>', help: 'fixed view zoom level (0 = auto-fit to the track)' },
    default: 0,
    normalize: (v, name) => ({ zoom: asNumber(v, name) }),
  },
  {
    key: 'zoomOut',
    cli: { flags: '--zoom-out <n>', help: 'auto-fit only: pull back n zoom levels' },
    default: 1,
    normalize: (v, name) => ({ zoomOut: asNumber(v, name) }),
  },
  {
    key: 'introSec',
    cli: { flags: '--intro-sec <s>', help: 'intro: zoom in from one level out over s seconds' },
    default: 2,
    normalize: (v, name) => ({ introSec: asNumber(v, name) }),
  },
  {
    key: 'outroSec',
    cli: { flags: '--outro-sec <s>', help: 'outro: zoom back out over s seconds' },
    default: 2,
    normalize: (v, name) => ({ outroSec: asNumber(v, name) }),
  },
  {
    key: 'hud',
    cli: {
      flags: '--hud <list>',
      help: 'comma list of heading,alt,speed - or none (alt hides when unavailable)',
    },
    default: { heading: true, alt: false, speed: false },
    normalize: (v, name) => ({ hud: parseHud(asString(v, name)) }),
  },
  {
    key: 'workers',
    cli: { flags: '--workers <n>', help: 'parallel browser pages' },
    default: 4,
    normalize: (v, name) => ({ workers: asNumber(v, name) }),
  },
  {
    key: 'capture',
    cli: { flags: '--capture <mode>', help: 'frame capture mode (canvas is parked)', choices: CAPTURE_VALUES },
    default: 'jpeg',
    normalize: (v, name) => ({ capture: asEnum(v, name, CAPTURE_VALUES) }),
  },
  {
    key: 'preset',
    cli: { flags: '--preset <name>', help: 'x264 preset', choices: PRESET_VALUES },
    default: 'medium',
    normalize: (v, name) => ({ preset: asEnum(v, name, PRESET_VALUES) }),
  },
  {
    key: 'tileCache',
    cli: { flags: '--tile-cache <dir>', help: 'tile cache directory (default: per-user cache dir)' },
    default: '',
    normalize: (v, name) => ({ tileCache: asString(v, name) }),
  },
  {
    key: 'browser',
    cli: { flags: '--browser <path>', help: 'Chromium/Chrome/Edge executable (default: system Chrome/Edge)' },
    default: null,
    normalize: (v, name) => ({ browser: asNullableString(v, name) }),
  },
  {
    key: 'skipExisting',
    cli: {
      flags: '--skip-existing',
      help: 'skip recordings whose output already exists and matches the source',
    },
    default: false,
    normalize: (v, name) => ({ skipExisting: asBool(v, name) }),
  },
  {
    key: 'recurse',
    cli: { flags: '--recurse', help: 'scan input folders recursively' },
    default: false,
    normalize: (v, name) => ({ recurse: asBool(v, name) }),
  },
  {
    key: 'json',
    cli: { flags: '--json', help: 'print one NDJSON summary line per recording on stdout' },
    default: false,
    normalize: (v, name) => ({ json: asBool(v, name) }),
  },
  {
    key: 'quiet',
    cli: { flags: '-q, --quiet', help: 'suppress progress output' },
    default: false,
    normalize: (v, name) => ({ quiet: asBool(v, name) }),
  },
];

// The CLI spells a default the way commander expects it. The config-native
// default stays in the table's `default` column so DEFAULT_CONFIG is a straight
// copy. Three kinds differ from their config form: a boolean default stays a
// boolean (commander's presence flags), a null default becomes the empty string
// ("not set") - "null" would read as a literal path - and the HUD spec becomes
// its comma string.
export function cliDefaultOf(key: keyof RenderConfig): string | boolean {
  const row = CONFIG_OPTIONS.find((r) => r.key === key);
  if (!row) throw new Error(`unknown config key ${String(key)}`);
  const value = row.default as unknown;
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return '';
  return key === 'hud' ? formatHud(value as HudSpec) : String(value);
}

// Frozen so no resolved config can corrupt the shared defaults; merges copy
// the hud spec so every resolved config owns its own mutable copy.
export const DEFAULT_CONFIG: RenderConfig = Object.freeze(
  Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, row.default]),
  ) as unknown as RenderConfig,
);
Object.freeze(DEFAULT_CONFIG.hud);

// Keyed lookup built from the option table; a key's normalizer is found by its
// name, and an unknown key is a usage error naming the origin.
const OVERRIDE_NORMALIZERS: Record<keyof RenderConfig, OverrideNormalizer> =
  Object.fromEntries(
    CONFIG_OPTIONS.map((row) => [row.key, row.normalize]),
  ) as Record<keyof RenderConfig, OverrideNormalizer>;

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

export function effectiveZoomOut(config: Pick<RenderConfig, 'zoom' | 'zoomOut'>): number {
  return config.zoom > 0 ? 0 : config.zoomOut;
}

// The smallest canvas the renderer and the app's dimension fields accept, in
// one home so the CLI, the pipeline and the export modal cannot disagree.
export const MIN_DIMENSION = 64;

// The negated comparisons are NaN-safe: they also reject NaN sneak-ins.
export function validateDimensions(width: number, height: number): void {
  if (!(width >= MIN_DIMENSION) || !(height >= MIN_DIMENSION)) {
    throw new Error(`width and height must be at least ${MIN_DIMENSION}`);
  }
}

export function validateRenderConfig(config: RenderConfig): void {
  validateDimensions(config.width, config.height);
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

// ---- export vocabulary (the UI's export modal -> the app's export job) ----

/** Inclusive source-frame range, e.g. the loop's In/Out points. */
export interface FrameRange {
  start: number;
  end: number;
}

export interface ExportRequest {
  /** Destination path; the .mp4 extension fixes the container. */
  outPath: string;
  /** The settings snapshot (panel look + export dimensions), frozen at confirm. */
  config: RenderConfig;
  /** Source-frame segment to export, or null for the full recording. */
  range: FrameRange | null;
}

// One rule for a usable frame range, shared by the request parser and the
// pipeline's range guard so they cannot drift.
export function assertValidFrameRange(range: FrameRange, name = 'frame range'): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error(`invalid ${name}: start and end must be integer frame indices`);
  }
  if (range.start < 0 || range.start >= range.end) {
    throw new Error(`invalid ${name}: expected 0 <= start < end, got ${range.start}-${range.end}`);
  }
}

export function parseFrameRange(raw: unknown, name = 'frame range'): FrameRange {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`invalid ${name}`);
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'start' && key !== 'end') {
      throw new Error(`unknown ${name} key ${key}`);
    }
  }
  const start = asNumber(r.start, `${name}: start`);
  const end = asNumber(r.end, `${name}: end`);
  assertValidFrameRange({ start, end }, name);
  return { start, end };
}

function parseHudObject(value: unknown, name: string): HudSpec {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`invalid value for ${name}`);
  }
  const h = value as Record<string, unknown>;
  for (const key of Object.keys(h)) {
    if (key !== 'heading' && key !== 'alt' && key !== 'speed') {
      throw new Error(`unknown key ${key} in ${name}`);
    }
  }
  return {
    heading: asBool(h.heading, `${name}: heading`),
    alt: asBool(h.alt, `${name}: alt`),
    speed: asBool(h.speed, `${name}: speed`),
  };
}

// Machine-owned settings the renderer never chooses: the main process's
// resolved values stay authoritative, so a snapshot cannot redirect the tile
// cache, the browser, the worker count or the CLI-only switches.
const MAIN_OWNED_KEYS = [
  'outDir', 'outSuffix', 'tileCache', 'browser', 'workers', 'capture', 'preset',
  'skipExisting', 'recurse', 'json', 'quiet',
] as const;

// The renderer sends the look and the export dimensions; everything else comes
// from the main process. The HUD spec travels in its CLI string form so the
// vocabulary's own normalizers stay the single validation home.
function parseRequestConfig(raw: unknown, base: RenderConfig): RenderConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid export request: config');
  }
  const flat = { ...(raw as Record<string, unknown>) };
  for (const key of MAIN_OWNED_KEYS) delete flat[key];
  if (flat.hud !== undefined && flat.hud !== null) {
    flat.hud = formatHud(parseHudObject(flat.hud, 'export request: config: hud'));
  }
  const config = { ...base, ...normalizeOverrides(flat, 'export request: config') };
  validateRenderConfig(config);
  return config;
}

export function parseExportRequest(raw: unknown, base: RenderConfig): ExportRequest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('invalid export request');
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'outPath' && key !== 'config' && key !== 'range') {
      throw new Error(`unknown export request key ${key}`);
    }
  }
  const outPath = asString(r.outPath, 'export request: outPath');
  if (!outPath.toLowerCase().endsWith('.mp4')) {
    throw new Error(`export request: outPath must be an .mp4 file: ${outPath}`);
  }
  const range =
    r.range === undefined || r.range === null ? null : parseFrameRange(r.range);
  return { outPath, config: parseRequestConfig(r.config, base), range };
}
