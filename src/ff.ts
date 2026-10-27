// ff.ts - ffmpeg/ffprobe preflight, source probing and output verification.
// ffmpeg and ffprobe are expected on PATH (never bundled).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Fps {
  num: number;
  den: number;
  value: number;
  /** ffprobe-style rate string, e.g. "30" or "30000/1001". */
  str: string;
}

export interface VideoProbe {
  fps: Fps;
  frames: number;
  durationSec: number;
  width: number;
  height: number;
}

export interface VerifyResult {
  frames: number;
  fps: string | null;
  ok: boolean;
}

const INSTALL_HINT =
  'install ffmpeg (includes ffprobe) and make sure both are on PATH, e.g. ' +
  '"winget install Gyan.FFmpeg" (Windows), "brew install ffmpeg" (macOS) or ' +
  '"apt install ffmpeg" (Linux)';

const FFPROBE_MAX_BUFFER = 64 * 1024 * 1024;

export async function requireTools(): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      await execFileAsync(tool, ['-version'], { maxBuffer: 1 << 20 });
    } catch {
      throw new Error(`${tool} is required but was not found on PATH - ${INSTALL_HINT}`);
    }
  }
}

// Run ffprobe with caller-supplied arguments and parse its JSON output.
export async function ffprobeJson(
  videoPath: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', ...args, videoPath],
    { maxBuffer: FFPROBE_MAX_BUFFER },
  );
  return JSON.parse(stdout || '{}') as Record<string, unknown>;
}

// Parse an ffprobe rate string ("30", "30000/1001"); null when unusable.
function parseFpsRate(str?: string): Fps | null {
  if (!str || str === '0/0') return null;
  const [num, den] = str.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num === 0) {
    return null;
  }
  return {
    num,
    den,
    value: num / den,
    str: den === 1 ? String(num) : `${num}/${den}`,
  };
}

function parseCount(text: string | undefined): number {
  return Number.parseInt(text ?? '', 10);
}

// ffprobe result shapes we rely on.
interface ProbeStream {
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  width?: number;
  height?: number;
}

interface ProbeFormat {
  duration?: string;
}

function firstStream(j: Record<string, unknown>): ProbeStream {
  return ((j['streams'] as ProbeStream[] | undefined) ?? [])[0] ?? {};
}

export async function probeVideo(
  videoPath: string,
  log: (msg: string) => void = () => {},
): Promise<VideoProbe> {
  const j = await ffprobeJson(videoPath, [
    '-select_streams', 'v:0',
    '-show_entries',
    'stream=r_frame_rate,avg_frame_rate,nb_frames,width,height:format=duration',
    '-of', 'json',
  ]);
  const stream = firstStream(j);
  const format = (j['format'] as ProbeFormat | undefined) ?? {};

  const fps =
    parseFpsRate(stream.r_frame_rate) ??
    parseFpsRate(stream.avg_frame_rate);
  if (!fps) throw new Error('could not determine the frame rate of the video');

  const durationSec = Number.parseFloat(format.duration ?? '');
  let frames = parseCount(stream.nb_frames);
  if (!Number.isFinite(frames) || frames <= 0) {
    frames = Math.round(durationSec * fps.value);
    log('warning: nb_frames missing, using duration x fps');
  }
  // A NaN frame count would flow into renderVideo (zero workers, empty
  // ffmpeg input) and fail much later with a confusing message.
  if (!Number.isFinite(frames) || frames <= 0) {
    throw new Error(
      `could not determine the frame count of ${videoPath} ` +
        '(nb_frames missing and duration unusable)',
    );
  }
  return {
    fps,
    frames,
    durationSec,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
  };
}

// Verify that an output has exactly the expected frame count and frame rate.
export async function verifyOutput(
  outPath: string,
  frames: number,
  fpsValue: number,
): Promise<VerifyResult> {
  const j = await ffprobeJson(outPath, [
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,r_frame_rate',
    '-of', 'json',
  ]);
  const stream = firstStream(j);
  const gotFrames = parseCount(stream.nb_frames);
  const gotRate = stream.r_frame_rate ?? '0/0';
  const [num, den] = gotRate.split('/').map(Number);
  const gotValue = den ? num / den : num;
  return {
    frames: gotFrames,
    fps: stream.r_frame_rate ?? null,
    ok:
      gotFrames === frames &&
      Number.isFinite(gotValue) &&
      Math.abs(gotValue - fpsValue) < 1e-6,
  };
}

async function probeRateFrames(file: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate,nb_frames',
      '-of', 'csv=p=0', '--', file,
    ],
    { maxBuffer: 1 << 20 },
  );
  return stdout.trim();
}

// True when the output exists and its frame count + frame rate match the source.
export async function outputMatchesSource(
  src: string,
  out: string,
): Promise<boolean> {
  try {
    const [srcRate, srcFrames] = (await probeRateFrames(src)).split(',');
    const [outRate, outFrames] = (await probeRateFrames(out)).split(',');
    return Number(outFrames) > 0 && srcRate === outRate && srcFrames === outFrames;
  } catch {
    return false;
  }
}
