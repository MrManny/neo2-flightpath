// HTTP byte-range parsing and response planning (RFC 7233) shared by the
// headless render server and the app's custom-scheme handler.

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

export type RangePlan =
  | { status: 200; headers: Record<string, string> }
  | { status: 206; headers: Record<string, string>; span: ByteRange }
  | { status: 416; headers: Record<string, string>; body: string };

// Everything both transports compute by hand for one Range request: status,
// the response headers, and the byte span (or 416 body) to send. Only the
// transport write is left to the caller.
export function rangePlan(
  header: string | string[] | undefined,
  size: number,
  mime: string,
): RangePlan {
  const range = parseRange(header, size);
  if (range === 'unsatisfiable') {
    return {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Content-Type': 'text/plain' },
      body: 'range not satisfiable',
    };
  }
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range === null ? size : range.end - range.start + 1),
  };
  if (range === null) return { status: 200, headers };
  headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  return { status: 206, headers, span: range };
}
