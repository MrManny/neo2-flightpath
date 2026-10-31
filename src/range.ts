// HTTP byte-range parsing (RFC 7233) shared by the headless render server and
// the app's custom-scheme handler.

export interface ByteRange {
  start: number;
  end: number;
}

// Malformed range headers are ignored (full response); only syntactically
// valid but unsatisfiable ranges earn a 416.
export function parseRange(
  header: string | string[] | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  if (header === undefined) return null;
  const text = Array.isArray(header) ? header[0] : header;
  const m = /^bytes=(\d*)-(\d*)$/.exec(text.trim());
  if (!m) return null;
  const from = m[1];
  const to = m[2];
  if (from === '' && to === '') return null;
  let start: number;
  let end: number;
  if (from === '') {
    const suffix = Number(to);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}
