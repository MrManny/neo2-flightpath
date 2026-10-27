// cammeta.ts - extract per-frame telemetry from the DJI 'CAM meta' MP4 stream.
//
// Format (reverse-engineered and verified value-by-value against .SRT data):
//   * the MP4 carries a `data` stream, sample-entry fourcc `djmd`, handler
//     "CAM meta"; its payload is DJI's internal "DVTM" (DJI Video Metadata)
//     protobuf: one ProductMeta message per MP4 sample = one video frame.
//     Messages are VARIABLE length (e.g. 299-563 B on DJI Neo 2) - never
//     assume a fixed stride; split the raw dump by ffprobe packet sizes so
//     each message aligns to its packet PTS (= frame time).
//   * ProductMeta { 1 clip_meta, 2 stream_meta, 3 frame_meta } (clip/stream
//     meta appear only in the first sample).
//   * frame_meta { 1 header, 2 camera, 3 imu (absent on Neo 2), 4 drone,
//     5 gimbal }:
//       - camera.11 AbsoluteAltitude { 1 float32 meters MSL }
//       - drone.3   EulerAngle { 1 pitch, 2 roll, 3 yaw } varint deci-degrees
//                   (yaw = drone heading, valid even while hovering)
//       - drone.4   GpsBasic { 1 PositionCoord { 2 lat, 3 lon } doubles WGS84,
//                             2 gps_altitude_mm varint }
//       - drone.5   RelativeAltitude { 1 float32 millimeters above takeoff }
//   * No epoch timestamp in-stream (frame_timestamp is microseconds since
//     power-up); sample index == frame index.
//   * Schemas: recovered DJI .proto files in AdrianEddy/telemetry-parser
//     (MIT/Apache-2.0, dvtm_library.proto / dvtm_eagle4_wa530.proto);
//     there is no official DJI spec and no public dvtm_NEO2.proto, but the
//     Neo 2 layout matches those schemas.
//
// Robustness: a per-packet protobuf walk is the primary path; a whole-buffer
// byte scan of the GPS double pair (tag 0x11 lat / 0x19 lon) is the fallback
// for firmware layouts we do not understand.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProductMeta {
  lat: number | null;
  lon: number | null;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
}

export interface CamSample extends ProductMeta {
  tSec: number;
}

export interface CamMetaResult {
  samples: CamSample[];
  method: 'dvtm-packets' | 'cammeta-scan';
}

interface FieldItem {
  wire: number;
  num: number;
  big?: bigint;
  dbl?: number;
  flt?: number;
  bytes?: [number, number];
}
type FieldMap = Map<number, FieldItem[]>;

async function ffprobeJson(
  videoPath: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const r = await execFileAsync('ffprobe', ['-v', 'error', ...args, videoPath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(r.stdout || '{}') as Record<string, unknown>;
}

// Find the data-stream index whose handler_name is 'CAM meta'.
// Returns null when the stream layout is unreadable or absent.
export async function findCamMetaIndex(
  videoPath: string,
): Promise<number | null> {
  let j: Record<string, unknown>;
  try {
    j = await ffprobeJson(videoPath, [
      '-select_streams',
      'd',
      '-show_entries',
      'stream=index:stream_tags=handler_name',
      '-of',
      'json',
    ]);
  } catch {
    return null;
  }
  const streams = (j['streams'] ?? []) as Array<{
    index: number;
    tags?: { handler_name?: string };
  }>;
  for (const s of streams) {
    if (s.tags && s.tags.handler_name === 'CAM meta') return s.index;
  }
  return null;
}

// --- minimal protobuf wire reader -------------------------------------------

interface Varint {
  value: bigint;
  next: number;
}

function readVarint(buf: Buffer, p: number, end: number): Varint | null {
  let value = 0n;
  let shift = 0n;
  let i = p;
  while (i < end && i - p < 10) {
    const b = buf[i++];
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, next: i };
    shift += 7n;
  }
  return null;
}

function toSigned(value: bigint): number {
  return Number(BigInt.asIntN(64, value));
}

// Parse one protobuf message level into Map<fieldNum, [items]>.
function parseFields(buf: Buffer, start: number, end: number): FieldMap {
  const out: FieldMap = new Map();
  let p = start;
  while (p < end) {
    const key = readVarint(buf, p, end);
    if (!key) break;
    const num = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    p = key.next;
    if (wire === 0) {
      const v = readVarint(buf, p, end);
      if (!v) break;
      p = v.next;
      push(out, num, { wire, num, big: v.value });
    } else if (wire === 1) {
      if (p + 8 > end) break;
      push(out, num, { wire, num, dbl: buf.readDoubleLE(p) });
      p += 8;
    } else if (wire === 2) {
      const len = readVarint(buf, p, end);
      if (!len) break;
      p = len.next;
      const n = Number(len.value);
      if (p + n > end) break;
      push(out, num, { wire, num, bytes: [p, p + n] });
      p += n;
    } else if (wire === 5) {
      if (p + 4 > end) break;
      push(out, num, { wire, num, flt: buf.readFloatLE(p) });
      p += 4;
    } else {
      break; // groups / unknown wire types: stop this level
    }
  }
  return out;
}

function push(map: FieldMap, num: number, item: FieldItem): void {
  const arr = map.get(num);
  if (arr) arr.push(item);
  else map.set(num, [item]);
}

function subFields(
  buf: Buffer,
  fields: FieldMap,
  num: number,
): FieldMap | null {
  const items = fields.get(num);
  if (!items || items.length === 0 || !items[0].bytes) return null;
  const [a, b] = items[0].bytes;
  return parseFields(buf, a, b);
}

function varintOf(fields: FieldMap, num: number): number | null {
  const items = fields.get(num);
  return items && items[0] && items[0].big !== undefined
    ? toSigned(items[0].big)
    : null;
}

function floatOf(fields: FieldMap, num: number): number | null {
  const items = fields.get(num);
  return items && items[0] && items[0].flt !== undefined
    ? items[0].flt
    : null;
}

function doubleOf(fields: FieldMap, num: number): number | null {
  const items = fields.get(num);
  return items && items[0] && items[0].dbl !== undefined
    ? items[0].dbl
    : null;
}

// Decode one ProductMeta message.
export function decodeProductMeta(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ProductMeta {
  const out: ProductMeta = {
    lat: null,
    lon: null,
    relAlt: null,
    absAlt: null,
    yawDeg: null,
    pitchDeg: null,
    rollDeg: null,
  };
  const top = parseFields(buf, start, end);
  const fm = subFields(buf, top, 3);
  if (!fm) return out;

  // camera.11 AbsoluteAltitude { 1 float32 meters }
  const cam = subFields(buf, fm, 2);
  if (cam) {
    const abs = subFields(buf, cam, 11);
    if (abs) out.absAlt = floatOf(abs, 1);
  }

  // drone block
  const drone = subFields(buf, fm, 4);
  if (!drone) return out;

  const gps = subFields(buf, drone, 4);
  if (gps) {
    const coord = subFields(buf, gps, 1);
    if (coord) {
      const lat = doubleOf(coord, 2);
      const lon = doubleOf(coord, 3);
      if (lat !== null && lon !== null && isPlausibleFix(lat, lon)) {
        out.lat = lat;
        out.lon = lon;
      }
    }
    if (out.absAlt === null) {
      const mm = varintOf(gps, 2);
      if (mm !== null) out.absAlt = mm / 1000;
    }
  }

  const rel = subFields(buf, drone, 5);
  if (rel) {
    const mm = floatOf(rel, 1);
    if (mm !== null && Number.isFinite(mm)) out.relAlt = mm / 1000;
  }

  const euler = subFields(buf, drone, 3);
  if (euler) {
    const p = varintOf(euler, 1);
    const r = varintOf(euler, 2);
    const y = varintOf(euler, 3);
    if (p !== null) out.pitchDeg = p / 10;
    if (r !== null) out.rollDeg = r / 10;
    if (y !== null) out.yawDeg = y / 10;
  }
  return out;
}

// Shared "real GPS fix" plausibility rule for the protobuf path and the
// byte-scan fallback - both must agree, otherwise a genuine fix within 0.5
// degrees of the equator or the prime meridian is accepted by one path and
// silently dropped by the other. The 0/0 "no GPS lock" placeholder is the
// only thing rejected by the threshold.
export function isPlausibleFix(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat > -90 &&
    lat < 90 &&
    lon > -180 &&
    lon < 180 &&
    !(Math.abs(lat) < 0.5 && Math.abs(lon) < 0.5)
  );
}

// Byte-scan fallback: the 0x11/0x19 fixed64 GPS double pair.
export function scanGpsPair(
  buf: Buffer,
  offset = 0,
  end = buf.length,
): { lat: number; lon: number; at: number } | null {
  for (let i = offset; i <= end - 18; i++) {
    if (buf[i] === 0x11 && buf[i + 9] === 0x19) {
      const lat = buf.readDoubleLE(i + 1);
      const lon = buf.readDoubleLE(i + 10);
      if (isPlausibleFix(lat, lon)) {
        return { lat, lon, at: i };
      }
    }
  }
  return null;
}

// Parse the whole 'CAM meta' stream of a video.
// opts.keepAll keeps every per-frame message even without a GPS fix (frame
// index then stays aligned to video frames; lat stays null). Default false
// keeps only GPS-bearing frames.
export async function parseCamMeta(
  videoPath: string,
  durationSec: number,
  opts: { keepAll?: boolean } = {},
): Promise<CamMetaResult | null> {
  const keepAll = opts.keepAll === true;
  const idx = await findCamMetaIndex(videoPath);
  if (idx === null) return null;

  let pk: Record<string, unknown>;
  try {
    pk = await ffprobeJson(videoPath, [
      // NOTE: bare stream index - `d:N` would mean the N-th *data* stream.
      '-select_streams',
      String(idx),
      '-show_entries',
      'packet=pts_time,size',
      '-of',
      'json',
    ]);
  } catch {
    return null;
  }
  const packets = ((pk['packets'] ?? []) as Array<{
    pts_time: string;
    size: string;
  }>).map((p) => ({
    t: Number.parseFloat(p.pts_time),
    size: Number.parseInt(p.size, 10),
  }));

  const tmp = path.join(
    os.tmpdir(),
    `cammeta_${process.pid}_${Date.now().toString(36)}.bin`,
  );
  let buf: Buffer | null = null;
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-v', 'error', '-y', '-i', videoPath,
        '-map', `0:${idx}`, '-c', 'copy', '-f', 'rawvideo', tmp,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    buf = fs.readFileSync(tmp);
  } catch {
    // keep buf null: extraction failed
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  if (!buf || buf.length === 0) return null;

  const samples: CamSample[] = [];
  const sizeSum = packets.reduce(
    (a, p) => a + (Number.isFinite(p.size) ? p.size : 0),
    0,
  );

  if (packets.length > 0 && sizeSum === buf.length) {
    // Preferred: per-packet protobuf walk -> exact PTS alignment.
    let off = 0;
    for (const p of packets) {
      const end = off + p.size;
      let meta = decodeProductMeta(buf, off, end);
      if (meta.lat === null) {
        const hit = scanGpsPair(buf, off, end);
        if (hit) meta = { ...meta, lat: hit.lat, lon: hit.lon };
      }
      if (meta.lat !== null || keepAll) {
        samples.push({
          // No PTS: pretend "same time as the first sample" rather than
          // fabricating a timeline out of a sample count (unit mismatch).
          tSec: Number.isFinite(p.t) ? p.t : 0,
          lat: meta.lat,
          lon: meta.lon,
          relAlt: meta.relAlt,
          absAlt: meta.absAlt,
          yawDeg: meta.yawDeg,
          pitchDeg: meta.pitchDeg,
          rollDeg: meta.rollDeg,
        });
      }
      off = end;
    }
    return { samples, method: 'dvtm-packets' };
  }

  // Fallback: whole-buffer GPS scan, uniform time spread over the duration.
  for (let i = 0; i <= buf.length - 18; i++) {
    const hit = scanGpsPair(buf, i, i + 18);
    if (hit) {
      samples.push({
        tSec: 0,
        lat: hit.lat,
        lon: hit.lon,
        relAlt: null,
        absAlt: null,
        yawDeg: null,
        pitchDeg: null,
        rollDeg: null,
      });
      i += 17;
    }
  }
  if (samples.length === 0) return null;
  const span =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : samples.length;
  samples.forEach((s, k) => {
    s.tSec = (k / Math.max(1, samples.length - 1)) * span;
  });
  return { samples, method: 'cammeta-scan' };
}
