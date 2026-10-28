// Just enough of the format for the DJI DVTM messages: varint, fixed64,
// fixed32 and length-delimited fields, one nesting level at a time.

const MAX_VARINT_BYTES = 10;

export interface Varint {
  value: bigint;
  next: number;
}

export interface ProtoField {
  wireType: number;
  fieldNumber: number;
  varintValue?: bigint;
  doubleValue?: number;
  floatValue?: number;
  /** Byte span [start, end) of a length-delimited payload. */
  bytesSpan?: [number, number];
}

export type ProtoFieldMap = Map<number, ProtoField[]>;

export function readVarint(
  buf: Buffer,
  pos: number,
  end: number,
): Varint | null {
  let value = 0n;
  let shift = 0n;
  let i = pos;
  while (i < end && i - pos < MAX_VARINT_BYTES) {
    const byte = buf[i++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7n;
  }
  return null;
}

/** Interpret a 64-bit varint as a signed integer. */
export function signedVarint(value: bigint): number {
  return Number(BigInt.asIntN(64, value));
}

export function parseProtoFields(
  buf: Buffer,
  start: number,
  end: number,
): ProtoFieldMap {
  const fields: ProtoFieldMap = new Map();
  let pos = start;
  while (pos < end) {
    const key = readVarint(buf, pos, end);
    if (!key) break;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    pos = key.next;
    const field = readValue(buf, pos, end, wireType, fieldNumber);
    if (!field) break; // groups / unknown wire types / truncation: stop this level
    pos = field.next;
    pushField(fields, fieldNumber, field.protoField);
  }
  return fields;
}

interface ReadFieldResult {
  protoField: ProtoField;
  next: number;
}

function readValue(
  buf: Buffer,
  pos: number,
  end: number,
  wireType: number,
  fieldNumber: number,
): ReadFieldResult | null {
  const base = { wireType, fieldNumber };
  if (wireType === 0) {
    const v = readVarint(buf, pos, end);
    return v && { protoField: { ...base, varintValue: v.value }, next: v.next };
  }
  if (wireType === 1) {
    if (pos + 8 > end) return null;
    return {
      protoField: { ...base, doubleValue: buf.readDoubleLE(pos) },
      next: pos + 8,
    };
  }
  if (wireType === 2) {
    const len = readVarint(buf, pos, end);
    if (!len) return null;
    const payloadStart = len.next;
    const n = Number(len.value);
    if (payloadStart + n > end) return null;
    return {
      protoField: { ...base, bytesSpan: [payloadStart, payloadStart + n] },
      next: payloadStart + n,
    };
  }
  if (wireType === 5) {
    if (pos + 4 > end) return null;
    return {
      protoField: { ...base, floatValue: buf.readFloatLE(pos) },
      next: pos + 4,
    };
  }
  return null;
}

function pushField(
  fields: ProtoFieldMap,
  fieldNumber: number,
  field: ProtoField,
): void {
  const existing = fields.get(fieldNumber);
  if (existing) existing.push(field);
  else fields.set(fieldNumber, [field]);
}

/** Sub-messages are length-delimited fields; only the first occurrence is decoded. */
export function subMessage(
  buf: Buffer,
  fields: ProtoFieldMap,
  fieldNumber: number,
): ProtoFieldMap | null {
  const field = fields.get(fieldNumber)?.[0];
  if (!field?.bytesSpan) return null;
  const [start, end] = field.bytesSpan;
  return parseProtoFields(buf, start, end);
}

export function firstVarint(
  fields: ProtoFieldMap,
  fieldNumber: number,
): number | null {
  const value = fields.get(fieldNumber)?.[0]?.varintValue;
  return value !== undefined ? signedVarint(value) : null;
}

export function firstFloat(
  fields: ProtoFieldMap,
  fieldNumber: number,
): number | null {
  const value = fields.get(fieldNumber)?.[0]?.floatValue;
  return value !== undefined ? value : null;
}

export function firstDouble(
  fields: ProtoFieldMap,
  fieldNumber: number,
): number | null {
  const value = fields.get(fieldNumber)?.[0]?.doubleValue;
  return value !== undefined ? value : null;
}
