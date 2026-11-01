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
import { gpsFix } from './geo.js';
import type { LatLon } from './geo.js';
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
  /** A real GPS fix, or null when the frame has none (see gpsFix). */
  fix: LatLon | null;
  /** Position pair present but not a real fix (see isGpsFix). */
  noLock: boolean;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
}

export interface CamSample extends ProductMeta {
  tSec: number;
}

export type CamMetaMethod = 'dvtm-packets' | 'cammeta-scan';

export interface CamMetaResult {
  samples: CamSample[];
  /** No-lock positions; the byte-scan fallback reports 0 (fix pairs only). */
  noLock: number;
  method: CamMetaMethod;
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
    fix: null,
    noLock: false,
    relAlt: null,
    absAlt: null,
    yawDeg: null,
    pitchDeg: null,
    rollDeg: null,
  };
}

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
  } catch (e) {
    throw new Error('ffprobe failed while probing the cam meta stream', { cause: e });
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

export function decodeProductMeta(
  buf: Buffer,
  start = 0,
  end = buf.length,
): ProductMeta {
  const top = parseProtoFields(buf, start, end);
  const frameMeta = subMessage(buf, top, FRAME_META);
  const absAlt = frameMeta ? decodeAbsoluteAltitude(buf, frameMeta) : null;
  const drone = frameMeta ? subMessage(buf, frameMeta, DRONE) : null;
  const gps = drone ? decodeGps(buf, drone) : null;
  const euler = drone ? decodeEulerAngles(buf, drone) : null;
  return {
    fix: gps?.fix ?? null,
    noLock: gps?.noLock ?? false,
    relAlt: drone ? decodeRelativeAltitude(buf, drone) : null,
    // camera.11 is authoritative; gps_altitude_mm is its fallback.
    absAlt: absAlt ?? gps?.gpsAltM ?? null,
    yawDeg: euler?.yawDeg ?? null,
    pitchDeg: euler?.pitchDeg ?? null,
    rollDeg: euler?.rollDeg ?? null,
  };
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

// drone.4 GpsBasic: WGS84 lat/lon doubles plus gps_altitude_mm (the
// absolute-altitude fallback when camera.11 is missing). A position pair
// that fails gpsFix is the no-lock placeholder: counted, never a fix.
interface GpsDecode {
  fix: LatLon | null;
  /** Position pair present but not a real fix (see isGpsFix). */
  noLock: boolean;
  /** gps_altitude_mm as meters; the absolute-altitude fallback. */
  gpsAltM: number | null;
}

function decodeGps(buf: Buffer, drone: ProtoFieldMap): GpsDecode {
  const out: GpsDecode = { fix: null, noLock: false, gpsAltM: null };
  const gps = subMessage(buf, drone, GPS_BASIC);
  if (!gps) return out;

  const coord = subMessage(buf, gps, POSITION_COORD);
  if (coord) {
    const lat = firstDouble(coord, LAT);
    const lon = firstDouble(coord, LON);
    // Only a present pair is an event: a fix, or exactly one no-lock count.
    if (lat !== null && lon !== null) {
      const fix = gpsFix(lat, lon);
      if (fix !== null) out.fix = fix;
      else out.noLock = true;
    }
  }
  const altitudeMm = firstVarint(gps, GPS_ALTITUDE_MM);
  if (altitudeMm !== null) out.gpsAltM = altitudeMm / 1000;
  return out;
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
interface EulerDecode {
  pitchDeg: number | null;
  rollDeg: number | null;
  yawDeg: number | null;
}

function decodeEulerAngles(buf: Buffer, drone: ProtoFieldMap): EulerDecode {
  const euler = subMessage(buf, drone, EULER_ANGLE);
  if (!euler) return { pitchDeg: null, rollDeg: null, yawDeg: null };
  const pitch = firstVarint(euler, PITCH);
  const roll = firstVarint(euler, ROLL);
  const yaw = firstVarint(euler, YAW);
  return {
    pitchDeg: pitch !== null ? pitch / 10 : null,
    rollDeg: roll !== null ? roll / 10 : null,
    yawDeg: yaw !== null ? yaw / 10 : null,
  };
}

// Byte-scan fallback: the 0x11/0x19 fixed64 GPS double pair. It judges
// coordinates through src/geo.ts's gpsFix - the same rule as the protobuf
// path, so a genuine fix is never accepted by one path and dropped by the
// other.
export function scanGpsPair(
  buf: Buffer,
  offset = 0,
  end = buf.length,
): { fix: LatLon; at: number } | null {
  for (let i = offset; i <= end - GPS_PAIR_SPAN; i++) {
    if (buf[i] === 0x11 && buf[i + 9] === 0x19) {
      const fix = gpsFix(buf.readDoubleLE(i + 1), buf.readDoubleLE(i + 10));
      if (fix !== null) return { fix, at: i };
    }
  }
  return null;
}

export interface PacketInfo {
  tSec: number;
  size: number;
}

// A probe failure is operational, not absence: it surfaces with its cause so
// a missing or broken ffprobe is never mistaken for a stream without data.
async function listCamMetaPackets(
  videoPath: string,
  streamIndex: number,
): Promise<PacketInfo[]> {
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
  } catch (e) {
    throw new Error('ffprobe failed while listing the cam meta packets', { cause: e });
  }
  return ((probe['packets'] ?? []) as Array<{
    pts_time: string;
    size: string;
  }>).map((packet) => ({
    tSec: Number.parseFloat(packet.pts_time),
    size: Number.parseInt(packet.size, 10),
  }));
}

async function dumpCamMetaStream(
  videoPath: string,
  streamIndex: number,
): Promise<Buffer> {
  const tmp = path.join(
    os.tmpdir(),
    `cammeta_${process.pid}_${Date.now().toString(36)}.bin`,
  );
  try {
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-v', 'error', '-y', '-i', videoPath,
          '-map', `0:${streamIndex}`, '-c', 'copy', '-f', 'rawvideo', tmp,
        ],
        { maxBuffer: FFMPEG_MAX_BUFFER },
      );
    } catch (e) {
      throw new Error('ffmpeg failed while dumping the cam meta stream', { cause: e });
    }
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function toCamSample(meta: ProductMeta, tSec: number): CamSample {
  return { tSec, ...meta };
}

// Primary path: walk the dump packet by packet so each ProductMeta message
// aligns to its packet PTS. No-lock packets are counted like SRT counts
// no-lock cues so summaries agree across telemetry sources; they join the
// samples only under keepAll.
export function decodePacketSamples(
  buf: Buffer,
  packets: PacketInfo[],
  keepAll: boolean,
): { samples: CamSample[]; noLock: number } {
  const samples: CamSample[] = [];
  let noLock = 0;
  let offset = 0;
  for (const packet of packets) {
    const end = offset + packet.size;
    let meta = decodeProductMeta(buf, offset, end);
    if (meta.fix === null) {
      const hit = scanGpsPair(buf, offset, end);
      if (hit) meta = { ...meta, fix: hit.fix, noLock: false };
    }
    if (meta.noLock) noLock++;
    if (meta.fix !== null || keepAll) {
      // No PTS: pretend "same time as the first sample" rather than
      // fabricating a timeline out of a sample count (unit mismatch).
      const tSec = Number.isFinite(packet.tSec) ? packet.tSec : 0;
      samples.push(toCamSample(meta, tSec));
    }
    offset = end;
  }
  return { samples, noLock };
}

// Fallback path: no frame alignment.
function scanBufferForGpsPairs(buf: Buffer): CamSample[] {
  const samples: CamSample[] = [];
  for (let i = 0; i <= buf.length - GPS_PAIR_SPAN; i++) {
    const hit = scanGpsPair(buf, i, i + GPS_PAIR_SPAN);
    if (hit) {
      const meta = emptyProductMeta();
      meta.fix = hit.fix;
      samples.push(toCamSample(meta, 0));
      i += GPS_PAIR_SPAN - 1;
    }
  }
  return samples;
}

// Best effort: scan-found samples carry no real timestamps.
function spreadSampleTimes(samples: CamSample[], durationSec: number): void {
  const span =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : samples.length;
  samples.forEach((sample, k) => {
    sample.tSec = (k / Math.max(1, samples.length - 1)) * span;
  });
}

// opts.keepAll keeps every per-frame message even without a GPS fix (frame
// index then stays aligned to video frames; lat stays null). Default false
// keeps only GPS-bearing frames.
export async function parseCamMeta(
  videoPath: string,
  durationSec: number,
  opts: { keepAll?: boolean } = {},
): Promise<CamMetaResult | null> {
  const keepAll = opts.keepAll === true;
  // Null returns below mark a genuine absence ("no CAM meta stream"); tool
  // failures have already thrown with their cause by this point.
  const streamIndex = await findCamMetaIndex(videoPath);
  if (streamIndex === null) return null;

  const packets = await listCamMetaPackets(videoPath, streamIndex);

  const buf = await dumpCamMetaStream(videoPath, streamIndex);
  if (buf.length === 0) return null;

  const sizeSum = packets.reduce(
    (sum, packet) => sum + (Number.isFinite(packet.size) ? packet.size : 0),
    0,
  );
  if (packets.length > 0 && sizeSum === buf.length) {
    const { samples, noLock } = decodePacketSamples(buf, packets, keepAll);
    return { samples, noLock, method: 'dvtm-packets' };
  }

  const samples = scanBufferForGpsPairs(buf);
  if (samples.length === 0) return null;
  spreadSampleTimes(samples, durationSec);
  // The scan sees complete fix pairs only - a no-lock placeholder is
  // indistinguishable from absent bytes in raw data.
  return { samples, noLock: 0, method: 'cammeta-scan' };
}
