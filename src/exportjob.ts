// The desktop app's export job runner, free of Electron APIs like
// src/appsession.ts: one blocking job at a time that renders to a working
// file and replaces the destination only after the output is verified, so a
// failed export never destroys a pre-existing file.

import fs from 'node:fs';
import path from 'node:path';

import type { ExportRequest } from './config.js';
import { errorMessage } from './errors.js';
import { samePath, uniquePath } from './paths.js';
import { processRecording } from './run.js';
import type { LogFn, RecordingSummary } from './run.js';

export type ExportOutcome =
  | { status: 'ok'; summary: RecordingSummary }
  | { status: 'error'; error: string }
  | { status: 'canceled' };

export type RunExportJob = (
  videoPath: string,
  request: ExportRequest,
  log: LogFn,
  workingPath: string,
  signal: AbortSignal,
) => Promise<RecordingSummary>;

// The pipeline is called exactly like the CLI calls it: one job, the
// snapshot's config, the frozen range.
const runViaPipeline: RunExportJob = (videoPath, request, log, workingPath, signal) =>
  processRecording(videoPath, request.config, log, workingPath, {
    range: request.range ?? undefined,
    signal,
  });

export interface ExportRunnerOptions {
  log?: LogFn;
  onDone: (outcome: ExportOutcome) => void;
  run?: RunExportJob;
}

export interface ExportRunner {
  /** Throws on spot rejections; the finished job reports through onDone. */
  start(videoPath: string, request: ExportRequest): void;
  cancel(): void;
  running(): boolean;
}

// The working file must keep the .mp4 suffix (ffmpeg infers the container
// from it) and share the destination's directory so the final rename stays
// on one volume. Existing names are never reused or deleted: a stray file
// there may belong to someone else.
function workingPathFor(outPath: string): string {
  const dir = path.dirname(outPath);
  const stem = `${path.basename(outPath, path.extname(outPath))}.partial`;
  return uniquePath(dir, stem, '.mp4', (candidate) => fs.existsSync(candidate));
}

// Best-effort removal of our own working file; a cleanup failure must never
// mask the job's real error.
function removeQuietly(working: string): void {
  try {
    fs.rmSync(working, { force: true });
  } catch {
    // nothing sensible to do
  }
}

// The module's core invariant: the destination is replaced only after the
// render is complete and verified. A failed swap must keep the finished
// render at the working path (e.g. when a player holds the destination open).
function swapIntoPlace(working: string, outPath: string): void {
  try {
    fs.renameSync(working, outPath);
  } catch (e) {
    throw new Error(
      `could not replace ${outPath}: ${errorMessage(e)} ` +
        `(the finished render is at ${working})`,
      { cause: e },
    );
  }
}

export function createExportRunner(options: ExportRunnerOptions): ExportRunner {
  const log = options.log ?? ((): void => {});
  const run = options.run ?? runViaPipeline;
  let job: { abort: () => void } | null = null;

  async function execute(
    videoPath: string,
    request: ExportRequest,
    working: string,
    controller: AbortController,
  ): Promise<ExportOutcome> {
    let summary: RecordingSummary;
    try {
      summary = await run(videoPath, request, log, working, controller.signal);
    } catch (e) {
      removeQuietly(working);
      return controller.signal.aborted
        ? { status: 'canceled' }
        : { status: 'error', error: errorMessage(e) };
    }
    try {
      swapIntoPlace(working, request.outPath);
    } catch (e) {
      return { status: 'error', error: errorMessage(e) };
    }
    log(`exported: ${request.outPath}`);
    return { status: 'ok', summary: { ...summary, out: request.outPath } };
  }

  return {
    start(videoPath: string, request: ExportRequest): void {
      if (job) throw new Error('an export is already running');
      if (!path.isAbsolute(request.outPath)) {
        throw new Error(`output path must be absolute: ${request.outPath}`);
      }
      if (samePath(request.outPath, videoPath)) {
        throw new Error('the output must not overwrite the source recording');
      }
      const controller = new AbortController();
      job = { abort: () => controller.abort() };
      const working = workingPathFor(request.outPath);
      // The catch guard contains a consumer's throwing onDone (and any
      // broken chain): an unhandled rejection here would kill the process.
      void execute(videoPath, request, working, controller)
        .then((outcome) => {
          job = null;
          options.onDone(outcome);
        })
        .catch((e: unknown) => {
          job = null;
          log(`export completion failed: ${errorMessage(e)}`);
        });
    },
    cancel(): void {
      job?.abort();
    },
    running(): boolean {
      return job !== null;
    },
  };
}
