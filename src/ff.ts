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

export async function requireTools(): Promise<void> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      await execFileAsync(tool, ['-version'], { maxBuffer: 1 << 20 });
    } catch {
      throw new Error(`${tool} is required but was not found on PATH - ${INSTALL_HINT}`);
    }
  }
}

export async function probeVideo(
  videoPath: string,
  log: (msg: string) => void = () => {},
): Promise<VideoProbe> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries',
      'stream=r_frame_rate,avg_frame_rate,nb_frames,width,height:format=duration',
      '-of', 'json', videoPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout || '{}') as {
    streams?: Array<{
      r_frame_rate?: string;
      avg_frame_rate?: string;
      nb_frames?: string;
      width?: number;
      height?: number;
    }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0] ?? {};
  const fmt = j.format ?? {};

  const parseRate = (str?: string): Fps | null => {
    if (!str || str === '0/0') return null;
    const [n, d] = str.split('/').map(Number);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return null;
    return { num: n, den: d, value: n / d, str: d === 1 ? String(n) : `${n}/${d}` };
  };
  const fps = parseRate(s.r_frame_rate) ?? parseRate(s.avg_frame_rate);
  if (!fps) throw new Error('could not determine the frame rate of the video');

  const durationSec = Number.parseFloat(fmt.duration ?? '');
  let frames = Number.parseInt(s.nb_frames ?? '', 10);
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
    width: s.width ?? 0,
    height: s.height ?? 0,
  };
}

// Verify that an output has exactly the expected frame count and frame rate.
export async function verifyOutput(
  outPath: string,
  frames: number,
  fpsValue: number,
): Promise<VerifyResult> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_frames,r_frame_rate',
      '-of', 'json', outPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout || '{}') as {
    streams?: Array<{ nb_frames?: string; r_frame_rate?: string }>;
  };
  const s = j.streams?.[0] ?? {};
  const gotFrames = Number.parseInt(s.nb_frames ?? '', 10);
  const [n, d] = String(s.r_frame_rate ?? '0/0').split('/').map(Number);
  const gotValue = d ? n / d : n;
  return {
    frames: gotFrames,
    fps: s.r_frame_rate ?? null,
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
    const [sRate, sFrames] = (await probeRateFrames(src)).split(',');
    const [oRate, oFrames] = (await probeRateFrames(out)).split(',');
    return Number(oFrames) > 0 && sRate === oRate && sFrames === oFrames;
  } catch {
    return false;
  }
}
