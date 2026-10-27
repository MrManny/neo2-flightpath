// cli.ts - neo2-flightpath command-line interface (commander).
//
// Renders flight-path map overlay videos from DJI drone recordings: telemetry
// from the .SRT sidecar or the embedded CAM-meta (DVTM) stream, at EXACTLY the
// source frame rate and frame count.

import fs from 'node:fs';
import { Command, Option } from 'commander';

import { VERSION } from './version.js';
import { parseHud, resolveConfig } from './config.js';
import type { Capture, ConfigOverrides, Preset, Style, Trail, View } from './config.js';
import { collectRecordings } from './inputs.js';
import { requireTools } from './ff.js';
import { runBatch } from './run.js';
import type { RecordingSummary } from './run.js';

export interface ParsedCli {
  inputs: string[];
  cli: ConfigOverrides;
  configPath: string | null;
}

interface RawOpts {
  outDir?: string;
  outSuffix: string;
  width: string;
  height: string;
  style: Style;
  view: View;
  zoom: string;
  zoomOut: string;
  introSec: string;
  outroSec: string;
  hud: string;
  workers: string;
  capture: Capture;
  preset: Preset;
  trail: Trail;
  tileCache: string;
  browser?: string;
  skipExisting?: boolean;
  recurse?: boolean;
  json?: boolean;
  quiet?: boolean;
  config?: string;
}

function numOpt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid number for ${name}: ${value}`);
  return n;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('neo2-flightpath')
    .description(
      'Render flight-path map overlay videos from DJI drone recordings (telemetry ' +
        'from the .SRT sidecar or the embedded CAM-meta stream) at exactly the source ' +
        'frame rate and frame count.',
    )
    .version(VERSION)
    .argument(
      '<inputs...>',
      'video files and/or folders (folders are scanned for *.mp4)',
    )
    .option('--out-dir <dir>', 'output folder (default: beside each source video)')
    .option(
      '--out-suffix <suffix>',
      'output name = <basename><suffix>.mp4',
      '_map',
    )
    .option('--width <px>', 'canvas width in pixels (rounded down to even)', '768')
    .option('--height <px>', 'canvas height in pixels (rounded down to even)', '768')
    .addOption(
      new Option('--style <name>', 'map look')
        .choices(['satellite', 'topo'])
        .default('satellite'),
    )
    .addOption(
      new Option(
        '--view <mode>',
        'follow: drone stays centered and the map slides under it; overview: static whole-track map',
      )
        .choices(['follow', 'overview'])
        .default('follow'),
    )
    .option('--zoom <n>', 'fixed view zoom level (0 = auto-fit to the track)', '0')
    .option('--zoom-out <n>', 'auto-fit only: pull back n zoom levels', '1')
    .option('--intro-sec <s>', 'intro: zoom in from one level out over s seconds', '2')
    .option('--outro-sec <s>', 'outro: zoom back out over s seconds', '2')
    .option(
      '--hud <list>',
      'comma list of heading,alt,speed - or none (alt hides when unavailable)',
      'heading',
    )
    .option('--workers <n>', 'parallel browser pages', '4')
    .addOption(
      new Option('--capture <mode>', 'frame capture mode (canvas is parked)')
        .choices(['jpeg', 'png'])
        .default('jpeg'),
    )
    .addOption(
      new Option('--preset <name>', 'x264 preset')
        .choices(['medium', 'veryfast'])
        .default('medium'),
    )
    .addOption(
      new Option('--trail <mode>', 'trail update strategy')
        .choices(['full', 'incr'])
        .default('full'),
    )
    .option(
      '--tile-cache <dir>',
      'tile cache directory (default: per-user cache dir)',
    )
    .option(
      '--browser <path>',
      'Chromium/Chrome/Edge executable (default: system Chrome/Edge)',
    )
    .option(
      '--skip-existing',
      'skip recordings whose output already exists and matches the source',
    )
    .option('--recurse', 'scan input folders recursively')
    .option('--json', 'print one NDJSON summary line per recording on stdout')
    .option(
      '--config <path>',
      'config file (default: .neo2flightpath.json discovered upward from the working directory)',
    )
    .option('-q, --quiet', 'suppress progress output');
  return program;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const program = buildProgram();
  program.exitOverride();
  program.parse(argv, { from: 'user' });
  const opts = program.opts<RawOpts>();

  // Forward only options the user actually passed on the command line.
  // Commander's built-in defaults must never leak into the override layer:
  // resolveConfig would then let "CLI" always win over the config file and
  // silently break the documented "CLI flags > config file > defaults"
  // precedence.
  const given = (name: string): boolean =>
    program.getOptionValueSource(name) === 'cli';

  const cli: ConfigOverrides = {};
  if (given('outDir') && opts.outDir !== undefined) cli.outDir = opts.outDir;
  if (given('outSuffix')) cli.outSuffix = opts.outSuffix;
  if (given('width')) cli.width = numOpt(opts.width, '--width');
  if (given('height')) cli.height = numOpt(opts.height, '--height');
  if (given('style')) cli.style = opts.style;
  if (given('view')) cli.view = opts.view;
  if (given('zoom')) cli.zoom = numOpt(opts.zoom, '--zoom');
  if (given('zoomOut')) cli.zoomOut = numOpt(opts.zoomOut, '--zoom-out');
  if (given('introSec')) cli.introSec = numOpt(opts.introSec, '--intro-sec');
  if (given('outroSec')) cli.outroSec = numOpt(opts.outroSec, '--outro-sec');
  if (given('hud')) cli.hud = parseHud(opts.hud);
  if (given('workers')) cli.workers = numOpt(opts.workers, '--workers');
  if (given('capture')) cli.capture = opts.capture;
  if (given('preset')) cli.preset = opts.preset;
  if (given('trail')) cli.trail = opts.trail;
  if (given('tileCache')) cli.tileCache = opts.tileCache;
  if (given('browser')) cli.browser = opts.browser ?? null;
  if (given('skipExisting')) cli.skipExisting = opts.skipExisting ?? false;
  if (given('recurse')) cli.recurse = opts.recurse ?? false;
  if (given('json')) cli.json = opts.json ?? false;
  if (given('quiet')) cli.quiet = opts.quiet ?? false;
  return {
    inputs: [...program.args],
    cli,
    configPath: opts.config ?? null,
  };
}

function isCommanderExit(e: unknown): e is { code: string; exitCode: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    (e as { code: string }).code.startsWith('commander.')
  );
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    const parsed = parseCliArgs(argv.slice(2));
    const { config, configPath } = resolveConfig({
      cli: parsed.cli,
      configPath: parsed.configPath,
    });

    const log = (msg: string): void => {
      if (!config.quiet) process.stderr.write(`[neo2-flightpath] ${msg}\n`);
    };

    await requireTools();
    const videos = collectRecordings(parsed.inputs, { recurse: config.recurse });
    if (config.outDir) fs.mkdirSync(config.outDir, { recursive: true });
    log(
      `${videos.length} recording(s) -> ${config.outDir ?? 'beside the sources'}` +
        (configPath ? ` (config: ${configPath})` : ''),
    );

    const emit = (summary: RecordingSummary): void => {
      if (config.json) {
        // Flush synchronously: the summary must survive any later I/O hiccups.
        fs.writeSync(1, `${JSON.stringify(summary)}\n`);
      }
    };

    const result = await runBatch(videos, config, log, emit);
    log(`done: ${result.ok} ok, ${result.skipped} skipped, ${result.failed} failed`);
    if (result.failed > 0) process.exitCode = 1;
  } catch (e) {
    if (isCommanderExit(e)) {
      // --help / --version already printed; other commander errors too.
      process.exitCode = e.code === 'commander.helpDisplayed' || e.code === 'commander.version'
        ? 0
        : e.exitCode;
      return;
    }
    process.stderr.write(
      `[neo2-flightpath] ERROR: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 1;
  }
}
