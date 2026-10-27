// srt.ts - parser for DJI SubRip telemetry sidecars (.SRT).
// One cue per video frame; the cue index equals the video frame index. Cues
// without a GPS fix (latitude/longitude 0/0 = "no GPS lock") are kept with
// lat/lon = null so alignment is never lost.

import { readFile } from 'node:fs/promises';

export interface SrtCue {
  /** Cue presentation time relative to the first cue (seconds). */
  tSec: number;
  /** Capture wall-clock time (local DJI timestamp, treated as a consistent timeline). */
  wallMs: number | null;
  lat: number | null;
  lon: number | null;
  relAlt: number | null;
  absAlt: number | null;
}

export interface SrtParseResult {
  cues: SrtCue[];
  /** Number of cues without a GPS fix (0/0). */
  noLock: number;
  count: number;
}

const RX_WALL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
const RX_TIMING = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->/;
const RX_LATLON =
  /\[latitude:\s*(-?\d+\.?\d*)\]\s*\[longitude:\s*(-?\d+\.?\d*)\]/;
const RX_ALT = /\[rel_alt:\s*(-?\d+\.?\d*)\s+abs_alt:\s*(-?\d+\.?\d*)\]/;

function num(s: string): number | null {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

export function parseSrtText(text: string): SrtParseResult {
  const cues: SrtCue[] = [];
  let noLock = 0;
  let baseMs: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/<[^>]*>/g, '').trim();
    if (!line) continue;

    const t = RX_TIMING.exec(line);
    if (t) {
      const ms =
        Number(t[1]) * 3600000 +
        Number(t[2]) * 60000 +
        Number(t[3]) * 1000 +
        Number(t[4]);
      if (baseMs === null) baseMs = ms;
      // A timing line always starts a new cue.
      cues.push({
        tSec: (ms - baseMs) / 1000,
        wallMs: null,
        lat: null,
        lon: null,
        relAlt: null,
        absAlt: null,
      });
      continue;
    }

    if (cues.length === 0) continue;
    const cue = cues[cues.length - 1];

    const w = RX_WALL.exec(line);
    if (w && cue.wallMs === null) {
      cue.wallMs = Date.UTC(
        Number(w[1]),
        Number(w[2]) - 1,
        Number(w[3]),
        Number(w[4]),
        Number(w[5]),
        Number(w[6]),
        Number(w[7]),
      );
      continue;
    }

    const g = RX_LATLON.exec(line);
    if (g && cue.lat === null) {
      const lat = num(g[1]);
      const lon = num(g[2]);
      if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
        cue.lat = lat;
        cue.lon = lon;
      } else {
        noLock++;
      }
    }

    const a = RX_ALT.exec(line);
    if (a && cue.relAlt === null) {
      cue.relAlt = num(a[1]);
      cue.absAlt = num(a[2]);
    }
  }

  return { cues, noLock, count: cues.length };
}

export async function parseSrt(path: string): Promise<SrtParseResult> {
  return parseSrtText(await readFile(path, 'utf8'));
}
