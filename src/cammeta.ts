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

import { ffprobeJson } from './ff.js';
import {
  firstDouble,
  firstFloat,
  firstVarint,
  parseProtoFields,
  subMessage,
} from './proto.js';
import type { ProtoFieldMap } from './proto.js';

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

// DVTM field numbers (see the module comment for the message layout).
const FRAME_META = 3;
const CAMERA = 2;
const ABSOLUTE_ALTITUDE = 11;
const DRONE = 4;
const GPS_BASIC = 4;
const POSITION_COORD = 1;
const GPS_ALTITUDE_MM = 2;
const RELATIVE_ALTITUDE = 5;
const EULER_ANGLE = 3;
const VALUE = 1;
const PITCH = 1;
const ROLL = 2;
const YAW = 3;
const LAT = 2;
const LON = 3;

// Size of the 0x11/0x19 fixed64 GPS double pair scanned by the fallback.
const GPS_PAIR_SPAN = 18;

const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

function emptyProductMeta(): ProductMeta {
  return {
    lat: null,
    lon: null,
    relAlt: null,
    absAlt: null,
    yawDeg: null,
    pitchDeg: null,
    rollDeg: null,
  };
}

// Find the data-stream index whose handler_name is 'CAM meta'.
// Returns null when the stream layout is unreadable or absent.
export async function findCamMetaIndex(
  videoPath: string,
): Promise<number | null> {
  let probe: Record<string, unknown>;
  try {
    probe = await ffprobeJson(videoPath, [
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
  const streams = (probe['streams'] ?? []) as Array<{
    index: number;
    tags?: { handler_name?: string };
  }>;
  for (const stream of streams) {
    if (stream.tags && stream.tags.handler_name === 'CAM meta') return stream.index;
  }
  return null;
}

// Decode one ProductMeta message.
export function decodeProductMeta(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ProductMeta {
  const out = emptyProductMeta();
  const top = parseProtoFields(buf, start, end);
  const frameMeta = subMessage(buf, top, FRAME_META);
  if (!frameMeta) return out;

  out.absAlt = decodeAbsoluteAltitude(buf, frameMeta) ?? out.absAlt;

  const drone = subMessage(buf, frameMeta, DRONE);
  if (!drone) return out;

  decodeGps(buf, drone, out);
  out.relAlt = decodeRelativeAltitude(buf, drone) ?? out.relAlt;
  decodeEulerAngles(buf, drone, out);
  return out;
}

// camera.11 AbsoluteAltitude { 1 float32 meters MSL }.
function decodeAbsoluteAltitude(
  buf: Buffer,
  frameMeta: ProtoFieldMap,
): number | null {
  const camera = subMessage(buf, frameMeta, CAMERA);
  const absoluteAltitude = camera && subMessage(buf, camera, ABSOLUTE_ALTITUDE);
  return absoluteAltitude ? firstFloat(absoluteAltitude, VALUE) : null;
}

// drone.4 GpsBasic: WGS84 lat/lon doubles plus gps_altitude_mm (used as the
// absolute-altitude fallback when camera.11 is missing).
function decodeGps(
  buf: Buffer,
  drone: ProtoFieldMap,
  out: ProductMeta,
): void {
  const gps = subMessage(buf, drone, GPS_BASIC);
  if (!gps) return;

  const coord = subMessage(buf, gps, POSITION_COORD);
  if (coord) {
    const lat = firstDouble(coord, LAT);
    const lon = firstDouble(coord, LON);
    if (lat !== null && lon !== null && isPlausibleFix(lat, lon)) {
      out.lat = lat;
      out.lon = lon;
    }
  }
  if (out.absAlt === null) {
    const altitudeMm = firstVarint(gps, GPS_ALTITUDE_MM);
    if (altitudeMm !== null) out.absAlt = altitudeMm / 1000;
  }
}

// drone.5 RelativeAltitude { 1 float32 millimeters above takeoff }.
function decodeRelativeAltitude(
  buf: Buffer,
  drone: ProtoFieldMap,
): number | null {
  const relative = subMessage(buf, drone, RELATIVE_ALTITUDE);
  const millimeters = relative ? firstFloat(relative, VALUE) : null;
  return millimeters !== null && Number.isFinite(millimeters)
    ? millimeters / 1000
    : null;
}

// drone.3 EulerAngle { 1 pitch, 2 roll, 3 yaw } varint deci-degrees.
function decodeEulerAngles(
  buf: Buffer,
  drone: ProtoFieldMap,
  out: ProductMeta,
): void {
  const euler = subMessage(buf, drone, EULER_ANGLE);
  if (!euler) return;
  const pitch = firstVarint(euler, PITCH);
  const roll = firstVarint(euler, ROLL);
  const yaw = firstVarint(euler, YAW);
  if (pitch !== null) out.pitchDeg = pitch / 10;
  if (roll !== null) out.rollDeg = roll / 10;
  if (yaw !== null) out.yawDeg = yaw / 10;
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
  for (let i = offset; i <= end - GPS_PAIR_SPAN; i++) {
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

interface PacketInfo {
  tSec: number;
  size: number;
}

// Packet sizes + PTS of the CAM meta stream; null when ffprobe cannot list
// them (the caller must then give up rather than guess alignments).
async function listCamMetaPackets(
  videoPath: string,
  streamIndex: number,
): Promise<PacketInfo[] | null> {
  let probe: Record<string, unknown>;
  try {
    probe = await ffprobeJson(videoPath, [
      // NOTE: bare stream index - `d:N` would mean the N-th *data* stream.
      '-select_streams',
      String(streamIndex),
      '-show_entries',
      'packet=pts_time,size',
      '-of',
      'json',
    ]);
  } catch {
    return null;
  }
  return ((probe['packets'] ?? []) as Array<{
    pts_time: string;
    size: string;
  }>).map((packet) => ({
    tSec: Number.parseFloat(packet.pts_time),
    size: Number.parseInt(packet.size, 10),
  }));
}

// Dump the raw CAM meta stream payload via ffmpeg; null when extraction fails.
async function dumpCamMetaStream(
  videoPath: string,
  streamIndex: number,
): Promise<Buffer | null> {
  const tmp = path.join(
    os.tmpdir(),
    `cammeta_${process.pid}_${Date.now().toString(36)}.bin`,
  );
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-v', 'error', '-y', '-i', videoPath,
        '-map', `0:${streamIndex}`, '-c', 'copy', '-f', 'rawvideo', tmp,
      ],
      { maxBuffer: FFMPEG_MAX_BUFFER },
    );
    return fs.readFileSync(tmp);
  } catch {
    return null; // extraction failed
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function toCamSample(meta: ProductMeta, tSec: number): CamSample {
  return { tSec, ...meta };
}

// Primary path: walk the dump packet by packet so each ProductMeta message
// aligns to its packet PTS. keepAll keeps frames without a GPS fix too.
function decodePacketSamples(
  buf: Buffer,
  packets: PacketInfo[],
  keepAll: boolean,
): CamSample[] {
  const samples: CamSample[] = [];
  let offset = 0;
  for (const packet of packets) {
    const end = offset + packet.size;
    let meta = decodeProductMeta(buf, offset, end);
    if (meta.lat === null) {
      const hit = scanGpsPair(buf, offset, end);
      if (hit) meta = { ...meta, lat: hit.lat, lon: hit.lon };
    }
    if (meta.lat !== null || keepAll) {
      // No PTS: pretend "same time as the first sample" rather than
      // fabricating a timeline out of a sample count (unit mismatch).
      const tSec = Number.isFinite(packet.tSec) ? packet.tSec : 0;
      samples.push(toCamSample(meta, tSec));
    }
    offset = end;
  }
  return samples;
}

// Fallback path: scan the whole dump for GPS pairs (no frame alignment).
function scanBufferForGpsPairs(buf: Buffer): CamSample[] {
  const samples: CamSample[] = [];
  for (let i = 0; i <= buf.length - GPS_PAIR_SPAN; i++) {
    const hit = scanGpsPair(buf, i, i + GPS_PAIR_SPAN);
    if (hit) {
      const meta = emptyProductMeta();
      meta.lat = hit.lat;
      meta.lon = hit.lon;
      samples.push(toCamSample(meta, 0));
      i += GPS_PAIR_SPAN - 1;
    }
  }
  return samples;
}

// Spread scan-found samples uniformly over the clip duration (best effort).
function spreadSampleTimes(samples: CamSample[], durationSec: number): void {
  const span =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : samples.length;
  samples.forEach((sample, k) => {
    sample.tSec = (k / Math.max(1, samples.length - 1)) * span;
  });
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
  const streamIndex = await findCamMetaIndex(videoPath);
  if (streamIndex === null) return null;

  const packets = await listCamMetaPackets(videoPath, streamIndex);
  if (packets === null) return null;

  const buf = await dumpCamMetaStream(videoPath, streamIndex);
  if (!buf || buf.length === 0) return null;

  const sizeSum = packets.reduce(
    (sum, packet) => sum + (Number.isFinite(packet.size) ? packet.size : 0),
    0,
  );
  if (packets.length > 0 && sizeSum === buf.length) {
    return {
      samples: decodePacketSamples(buf, packets, keepAll),
      method: 'dvtm-packets',
    };
  }

  const samples = scanBufferForGpsPairs(buf);
  if (samples.length === 0) return null;
  spreadSampleTimes(samples, durationSec);
  return { samples, method: 'cammeta-scan' };
}
