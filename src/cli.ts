import fs from 'node:fs';
import { Command, Option } from 'commander';

import { ERROR_PREFIX, errorMessage } from './errors.js';
import { VERSION } from './version.js';
import { CONFIG_OPTIONS, cliDefaultOf } from './config.js';
import { resolveConfig } from './configfile.js';
import type { ConfigOverrides, RenderConfig } from './config.js';
import { collectRecordings } from './inputs.js';
import { requireTools } from './ff.js';
import { runBatch } from './run.js';
import type { LogFn, RecordingSummary } from './run.js';
import { createTracing } from './tracing.js';
import type { Tracing } from './tracing.js';

export interface ParsedCli {
  inputs: string[];
  cli: ConfigOverrides;
  configPath: string | null;
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
    );
  for (const row of CONFIG_OPTIONS) {
    const option = new Option(row.cli.flags, row.cli.help);
    if (row.cli.choices) option.choices([...row.cli.choices]);
    // An empty CLI default means "not set"; commander would print a noisy
    // (default: "") for it, and the override layer reads only given flags.
    const defaultValue = cliDefaultOf(row.key);
    if (defaultValue !== '') option.default(defaultValue);
    program.addOption(option);
  }
  program.option(
    '--config <path>',
    'config file (default: .neo2flightpath.json discovered upward from the working directory)',
  );
  return program;
}

// Commander's built-in defaults must never leak into the override layer:
// resolveConfig would then let "CLI" always win over the config file and
// silently break the documented "CLI flags > config file > defaults"
// precedence.
function givenOnCommandLine(
  program: Command,
  name: string,
): boolean {
  return program.getOptionValueSource(name) === 'cli';
}

// The documented long flag of an option's spelling ("--quiet" for
// "-q, --quiet"), so error contexts never name a short alias.
export function longFlagOf(flags: string): string {
  const tokens = flags.split(/[ ,|]+/);
  return tokens.find((token) => token.startsWith('--')) ?? tokens[0];
}

// Collect only the flags the user actually set, each through its table
// normalizer, so a config-file value can still win over a CLI default.
function collectOverrides(program: Command): ConfigOverrides {
  const opts = program.opts<Record<string, unknown>>();
  const cli: ConfigOverrides = {};
  for (const row of CONFIG_OPTIONS) {
    if (!givenOnCommandLine(program, row.key)) continue;
    const flag = longFlagOf(row.cli.flags);
    const raw = row.cli.parse ? row.cli.parse(opts[row.key]) : opts[row.key];
    Object.assign(cli, row.normalize(raw, flag));
  }
  return cli;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const program = buildProgram();
  program.exitOverride();
  program.parse(argv, { from: 'user' });
  const opts = program.opts<Record<string, unknown>>();

  return {
    inputs: [...program.args],
    cli: collectOverrides(program),
    configPath: typeof opts.config === 'string' ? opts.config : null,
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

// --help / --version already printed and count as success.
function commanderExitCode(e: { code: string; exitCode: number }): number {
  return e.code === 'commander.helpDisplayed' || e.code === 'commander.version'
    ? 0
    : e.exitCode;
}

// The resolved invocation: everything the run needs once argv and the config
// layers are merged.
interface Invocation {
  inputs: string[];
  config: RenderConfig;
  configPath: string | null;
}

function resolveInvocation(argv: string[]): Invocation {
  const parsed = parseCliArgs(argv.slice(2));
  const { config, configPath } = resolveConfig({
    cli: parsed.cli,
    configPath: parsed.configPath,
  });
  return { inputs: parsed.inputs, config, configPath };
}

function createLogger(config: RenderConfig): LogFn {
  return (msg: string): void => {
    if (!config.quiet) process.stderr.write(`[neo2-flightpath] ${msg}\n`);
  };
}

// The pipeline stage: tools, inputs, output folder, batch, summary, and the
// batch's effect on the exit code.
async function runPipeline(
  invocation: Invocation,
  tracing: Tracing,
  log: LogFn,
): Promise<void> {
  const { inputs, config, configPath } = invocation;
  await requireTools();
  const videos = collectRecordings(inputs, { recurse: config.recurse });
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

  const result = await runBatch(videos, config, log, emit, {
    trace: { tracer: tracing.tracer },
  });
  log(`done: ${result.ok} ok, ${result.skipped} skipped, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

async function withTracingShutdown(
  tracing: Tracing,
  log: LogFn,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } finally {
    try {
      await tracing.shutdown();
    } catch (e) {
      // A shutdown hiccup must not replace the error that is unwinding.
      log(`warning: tracing shutdown failed: ${errorMessage(e)}`);
    }
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    const invocation = resolveInvocation(argv);
    const log = createLogger(invocation.config);
    const tracing = await createTracing();
    if (tracing.enabled) log(`tracing: enabled (OTLP/HTTP protobuf)`);
    await withTracingShutdown(tracing, log, () =>
      runPipeline(invocation, tracing, log),
    );
  } catch (e) {
    if (isCommanderExit(e)) {
      process.exitCode = commanderExitCode(e);
      return;
    }
    process.stderr.write(
      `${ERROR_PREFIX}${errorMessage(e)}\n`,
    );
    process.exitCode = 1;
  }
}
