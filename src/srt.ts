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

function parseNumber(text: string): number | null {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function stripFontTags(line: string): string {
  return line.replace(/<[^>]*>/g, '').trim();
}

function timingLineToMs(match: RegExpExecArray): number {
  return (
    Number(match[1]) * 3600000 +
    Number(match[2]) * 60000 +
    Number(match[3]) * 1000 +
    Number(match[4])
  );
}

function newCue(tSec: number): SrtCue {
  return {
    tSec,
    wallMs: null,
    lat: null,
    lon: null,
    relAlt: null,
    absAlt: null,
  };
}

export function parseSrtText(text: string): SrtParseResult {
  const cues: SrtCue[] = [];
  let noLock = 0;
  let baseMs: number | null = null;
  // A second (repeated) lat/lon line in one cue must not count as another
  // no-lock event - only the current cue can receive lines, so one flag is
  // enough to remember whether it already saw one.
  let cueSawLatLon = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripFontTags(rawLine);
    if (!line) continue;

    const timing = RX_TIMING.exec(line);
    if (timing) {
      const ms = timingLineToMs(timing);
      if (baseMs === null) baseMs = ms;
      // A timing line always starts a new cue.
      cues.push(newCue((ms - baseMs) / 1000));
      cueSawLatLon = false;
      continue;
    }

    if (cues.length === 0) continue;
    const cue = cues[cues.length - 1];

    const wall = RX_WALL.exec(line);
    if (wall && cue.wallMs === null) {
      cue.wallMs = Date.UTC(
        Number(wall[1]),
        Number(wall[2]) - 1,
        Number(wall[3]),
        Number(wall[4]),
        Number(wall[5]),
        Number(wall[6]),
        Number(wall[7]),
      );
      continue;
    }

    const latLon = RX_LATLON.exec(line);
    if (latLon && cue.lat === null && !cueSawLatLon) {
      cueSawLatLon = true;
      const lat = parseNumber(latLon[1]);
      const lon = parseNumber(latLon[2]);
      if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
        cue.lat = lat;
        cue.lon = lon;
      } else {
        noLock++;
      }
    }

    const alt = RX_ALT.exec(line);
    if (alt && cue.relAlt === null) {
      cue.relAlt = parseNumber(alt[1]);
      cue.absAlt = parseNumber(alt[2]);
    }
  }

  return { cues, noLock, count: cues.length };
}

export async function parseSrt(path: string): Promise<SrtParseResult> {
  return parseSrtText(await readFile(path, 'utf8'));
}
