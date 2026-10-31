import { describe, expect, it } from 'vitest';

import { decodePacketSamples, decodeProductMeta, scanGpsPair } from '../src/cammeta.js';
import type { PacketInfo } from '../src/cammeta.js';

function dbl(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value);
  return b;
}

function varint(value: number | bigint): Buffer {
  let v = BigInt.asUintN(64, BigInt(value));
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}

function tag(num: number, wire: number): Buffer {
  return varint((num << 3) | wire);
}

function fldVarint(num: number, value: number | bigint): Buffer {
  return Buffer.concat([tag(num, 0), varint(value)]);
}

function fldDouble(num: number, value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value);
  return Buffer.concat([tag(num, 1), b]);
}

function fldFloat(num: number, value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value);
  return Buffer.concat([tag(num, 5), b]);
}

function fldBytes(num: number, payload: Buffer): Buffer {
  return Buffer.concat([tag(num, 2), varint(payload.length), payload]);
}

interface Meta {
  lat: number;
  lon: number;
  relAltMm: number;
  absAltM?: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  gpsAltMm?: number;
}

// ProductMeta { 3 frame_meta { 2 camera, 4 drone } } per the verified field map.
function buildProductMeta(m: Meta): Buffer {
  const coord = Buffer.concat([fldDouble(2, m.lat), fldDouble(3, m.lon)]);
  const gpsParts = [fldBytes(1, coord)];
  if (m.gpsAltMm !== undefined) gpsParts.push(fldVarint(2, m.gpsAltMm));
  const gps = fldBytes(4, Buffer.concat(gpsParts));
  const rel = fldBytes(5, fldFloat(1, m.relAltMm));
  const euler = fldBytes(
    3,
    Buffer.concat([
      fldVarint(1, m.pitch ?? 0),
      fldVarint(2, m.roll ?? 0),
      fldVarint(3, m.yaw ?? 0),
    ]),
  );
  const drone = fldBytes(4, Buffer.concat([euler, gps, rel]));
  const cam =
    m.absAltM !== undefined
      ? fldBytes(2, fldBytes(11, fldFloat(1, m.absAltM)))
      : Buffer.alloc(0);
  const frameMeta = Buffer.concat([cam, drone]);
  return fldBytes(3, frameMeta);
}

describe('decodeProductMeta', () => {
  it('decodes GPS, altitudes and Euler angles from a synthetic message', () => {
    const buf = buildProductMeta({
      lat: 46.61307,
      lon: 14.262388,
      relAltMm: 3300,
      absAltM: 313.227,
      pitch: 123,
      roll: 456,
      yaw: 2700,
      gpsAltMm: 313227,
    });
    const m = decodeProductMeta(buf);
    expect(m.lat).toBeCloseTo(46.61307, 9);
    expect(m.lon).toBeCloseTo(14.262388, 9);
    expect(m.relAlt).toBeCloseTo(3.3, 4); // 3300 mm -> 3.3 m
    expect(m.absAlt).toBeCloseTo(313.227, 2); // float32 precision
    expect(m.pitchDeg).toBeCloseTo(12.3, 6); // deci-degrees
    expect(m.rollDeg).toBeCloseTo(45.6, 6);
    expect(m.yawDeg).toBeCloseTo(270.0, 6);
  });

  it('falls back to gps_altitude_mm when AbsoluteAltitude is missing', () => {
    const buf = buildProductMeta({
      lat: 46.61307,
      lon: 14.262388,
      relAltMm: 1000,
      gpsAltMm: 500123,
    });
    const m = decodeProductMeta(buf);
    expect(m.absAlt).toBeCloseTo(500.123, 3);
  });

  it('keeps near-null-island coordinates as fixes (regression)', () => {
    // The shared rule (src/geo.ts's isGpsFix) rejects only exactly 0/0;
    // the old 0.5-degree box used to drop these genuine fixes.
    const buf = buildProductMeta({
      lat: 0.0000001,
      lon: 0.0000001,
      relAltMm: 0,
    });
    const m = decodeProductMeta(buf);
    expect(m.lat).toBeCloseTo(0.0000001, 9);
    expect(m.noLock).toBe(false);
  });

  it('marks the 0/0 placeholder as a no-lock position', () => {
    const buf = buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 });
    const m = decodeProductMeta(buf);
    expect(m.lat).toBeNull();
    expect(m.lon).toBeNull();
    expect(m.noLock).toBe(true);
  });

  it('accepts genuine fixes near the equator / prime meridian', () => {
    const buf = buildProductMeta({ lat: 10.2, lon: 0.2, relAltMm: 1000 });
    const m = decodeProductMeta(buf);
    expect(m.lat).toBeCloseTo(10.2, 9);
    expect(m.lon).toBeCloseTo(0.2, 9);
  });
});

describe('scanGpsPair', () => {
  it('finds the 0x11/0x19 fixed64 GPS pair in raw bytes', () => {
    const pair = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x11]),
      (() => {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(46.61307);
        return b;
      })(),
      Buffer.from([0x19]),
      (() => {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(14.262388);
        return b;
      })(),
      Buffer.from([0x00]),
    ]);
    const hit = scanGpsPair(pair);
    expect(hit).not.toBeNull();
    expect(hit?.lat).toBeCloseTo(46.61307, 9);
    expect(hit?.lon).toBeCloseTo(14.262388, 9);
    expect(hit?.at).toBe(2);
  });

  it('rejects the 0/0 placeholder and out-of-range pairs', () => {
    for (const [lat, lon] of [
      [0, 0],
      [91, 0],
    ]) {
      const pair = Buffer.concat([
        Buffer.from([0x11]),
        dbl(lat),
        Buffer.from([0x19]),
        dbl(lon),
      ]);
      expect(scanGpsPair(pair)).toBeNull();
    }
  });

  it('applies the same GPS-fix rule as the protobuf path', () => {
    // Near the prime meridian (or the equator) and near null island: the
    // (0.1, 0.1) disagreement regression - genuine fixes neither path may
    // drop; only exactly 0/0 is the placeholder.
    for (const [lat, lon] of [
      [10.2, 0.2],
      [0.2, 10.2],
      [0.1, 0.1],
    ]) {
      const pair = Buffer.concat([
        Buffer.from([0x11]),
        dbl(lat),
        Buffer.from([0x19]),
        dbl(lon),
      ]);
      const hit = scanGpsPair(pair);
      expect(hit?.lat).toBeCloseTo(lat, 9);
      expect(hit?.lon).toBeCloseTo(lon, 9);

      const m = decodeProductMeta(buildProductMeta({ lat, lon, relAltMm: 0 }));
      expect(m.lat).toBeCloseTo(lat, 9);
      expect(m.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('decodePacketSamples', () => {
  function packetsOf(parts: Buffer[]): { buf: Buffer; packets: PacketInfo[] } {
    const packets: PacketInfo[] = [];
    let tSec = 0;
    for (const part of parts) {
      packets.push({ tSec, size: part.length });
      tSec += 1 / 30;
    }
    return { buf: Buffer.concat(parts), packets };
  }

  it('counts no-lock packets and keeps only fix samples by default', () => {
    const { buf, packets } = packetsOf([
      buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 }),
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }),
      buildProductMeta({ lat: 0.1, lon: 0.1, relAltMm: 0 }),
    ]);
    const { samples, noLock } = decodePacketSamples(buf, packets, false);
    expect(noLock).toBe(1);
    expect(samples.map((s) => s.lat)).toEqual([46.6, 0.1]);
  });

  it('keeps no-lock samples under keepAll but still counts them', () => {
    const { buf, packets } = packetsOf([
      buildProductMeta({ lat: 0, lon: 0, relAltMm: 0 }),
      buildProductMeta({ lat: 46.6, lon: 14.3, relAltMm: 0 }),
    ]);
    const { samples, noLock } = decodePacketSamples(buf, packets, true);
    expect(noLock).toBe(1);
    expect(samples).toHaveLength(2);
    expect(samples[0].noLock).toBe(true);
    expect(samples[0].lat).toBeNull();
    expect(samples[1].lat).toBe(46.6);
  });
});
