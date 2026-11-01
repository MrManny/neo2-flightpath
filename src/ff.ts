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
    } catch (e) {
      throw new Error(`${tool} is required but was not found on PATH - ${INSTALL_HINT}`, {
        cause: e,
      });
    }
  }
}

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

// One split of ffprobe's rate wire format ("30" or "30000/1001"), with each
// consumer's own policy on top: the probe needs a usable rate, the output
// verification only reads a value.
function parseRate(str: string): { num: number; den?: number } | null {
  const [num, den] = str.split('/').map(Number);
  return Number.isFinite(num) ? { num, den } : null;
}

function parseFpsRate(str?: string): Fps | null {
  const rate = str ? parseRate(str) : null;
  if (!rate || !Number.isFinite(rate.den) || rate.den === 0 || rate.num === 0) {
    return null;
  }
  const { num } = rate;
  const den = rate.den as number;
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
  const rate = parseRate(stream.r_frame_rate ?? '0/0');
  const gotValue = rate ? (rate.den ? rate.num / rate.den : rate.num) : null;
  return {
    frames: gotFrames,
    fps: stream.r_frame_rate ?? null,
    ok:
      gotFrames === frames &&
      gotValue !== null &&
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

// Missing or unreadable outputs count as a mismatch, not an error.
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
