// Without an endpoint no OpenTelemetry package is ever imported, so untraced
// runs keep their exact output and pay no overhead.

import type { Span as ApiSpan, Tracer as ApiTracer } from '@opentelemetry/api';
import type { SpanExporter } from '@opentelemetry/sdk-trace';

import { errorMessage } from './errors.js';
import { VERSION } from './version.js';

type OtelApi = typeof import('@opentelemetry/api');

export type SpanValue = string | number | boolean;

export interface Span {
  setAttribute(name: string, value: SpanValue): void;
  setAttributes(values: Record<string, SpanValue>): void;
  /** Record the failure on this span: exception event plus ERROR status. */
  fail(error: unknown): void;
  /** End the span. Later end()/fail() calls do nothing: spans with overlapping
   * lifecycles are wound down from several code paths. */
  end(): void;
  /** The OpenTelemetry handle for parenting; no-op spans have none. */
  readonly raw?: ApiSpan;
}

export interface StartSpanOptions {
  attributes?: Record<string, SpanValue>;
  /** Explicit parent; unparented spans are trace roots. */
  parent?: Span;
}

export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
}

// Passed as one object so pipeline and render signatures do not keep growing
// tracer/parent pairs.
export interface TraceContext {
  tracer: Tracer;
  parent?: Span;
}

export interface Tracing {
  enabled: boolean;
  tracer: Tracer;
  /** Push buffered spans to the exporter without closing it. */
  flush(): Promise<void>;
  /** Flush and close the exporter; call once when the run is over. */
  shutdown(): Promise<void>;
}

type Env = Record<string, string | undefined>;

const SERVICE_NAME = 'neo2-flightpath';
const OTLP_PROTOCOL = 'http/protobuf';

const noopSpan: Span = {
  setAttribute: () => {},
  setAttributes: () => {},
  fail: () => {},
  end: () => {},
};

export const NOOP_TRACER: Tracer = {
  startSpan: () => noopSpan,
};

function envFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function envText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isTracingEnabled(env: Env = process.env): boolean {
  const endpoint =
    envText(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) ??
    envText(env['OTEL_EXPORTER_OTLP_ENDPOINT']);
  return endpoint !== undefined && !envFlag(env['OTEL_SDK_DISABLED']);
}

// The signal-specific endpoint is used as-is; the generic one is a base URL
// the signal path is appended to (OTLP spec).
export function otlpTracesUrl(env: Env): string | undefined {
  const specific = envText(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']);
  if (specific) return specific;
  const base = envText(env['OTEL_EXPORTER_OTLP_ENDPOINT']);
  return base ? `${base.replace(/\/+$/, '')}/v1/traces` : undefined;
}

// `k1=v1,k2=v2` lists with URL-encoded values, as the OTEL header and
// resource-attribute variables use.
function parseKeyValueList(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (value ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

// Signal-specific headers win per key over the generic ones (OTLP spec).
export function otlpHeaders(env: Env): Record<string, string> {
  return {
    ...parseKeyValueList(envText(env['OTEL_EXPORTER_OTLP_HEADERS'])),
    ...parseKeyValueList(envText(env['OTEL_EXPORTER_OTLP_TRACES_HEADERS'])),
  };
}

// Parsed here instead of via envDetector because that reads process.env
// directly, which would leave the env seam half-applied.
export function resourceAttributesFromEnv(env: Env): Record<string, string> {
  const attrs = parseKeyValueList(envText(env['OTEL_RESOURCE_ATTRIBUTES']));
  const serviceName = envText(env['OTEL_SERVICE_NAME']);
  if (serviceName !== undefined) attrs['service.name'] = serviceName;
  return attrs;
}

// Exporting is fixed to OTLP/HTTP protobuf; a protocol variable promising
// anything else would silently push into the wrong port of the collector.
// Per the OTel spec the signal-specific variable wins over the generic one,
// so only the effective value is judged.
function assertSupportedProtocol(env: Env): void {
  const specific = envText(env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL']);
  const generic = envText(env['OTEL_EXPORTER_OTLP_PROTOCOL']);
  const name =
    specific !== undefined
      ? 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL'
      : 'OTEL_EXPORTER_OTLP_PROTOCOL';
  const value = specific ?? generic;
  if (value !== undefined && value.toLowerCase() !== OTLP_PROTOCOL) {
    throw new Error(
      `unsupported ${name}: ${value} (only ${OTLP_PROTOCOL} is supported)`,
    );
  }
}

// The span ends with the body (or earlier, if the body ends it), and a thrown
// error is recorded on it before it propagates.
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  options: StartSpanOptions,
  body: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  try {
    const result = await body(span);
    span.end();
    return result;
  } catch (e) {
    span.fail(e);
    span.end();
    throw e;
  }
}

// Parent and initial attributes are exactly what every stage site would
// otherwise spell out again.
export function stage<T>(
  tracer: Tracer,
  name: string,
  parent: Span | undefined,
  attributes: Record<string, SpanValue>,
  body: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(tracer, name, { parent, attributes }, body);
}

class OtelSpan implements Span {
  private ended = false;

  constructor(
    private readonly api: OtelApi,
    readonly raw: ApiSpan,
  ) {}

  setAttribute(name: string, value: SpanValue): void {
    this.raw.setAttribute(name, value);
  }

  setAttributes(values: Record<string, SpanValue>): void {
    this.raw.setAttributes(values);
  }

  fail(error: unknown): void {
    if (this.ended) return;
    const exception = error instanceof Error ? error : new Error(errorMessage(error));
    this.raw.recordException(exception);
    this.raw.setStatus({
      code: this.api.SpanStatusCode.ERROR,
      message: exception.message,
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.raw.end();
  }
}

class OtelTracer implements Tracer {
  constructor(
    private readonly api: OtelApi,
    private readonly raw: ApiTracer,
  ) {}

  startSpan(name: string, options?: StartSpanOptions): Span {
    const parent = options?.parent;
    // Unwrap through the Span interface, not instanceof. A parent without an
    // OpenTelemetry handle (a no-op or foreign span) would silently detach the
    // new span and quietly break the trace topology - refuse it instead.
    const parentRaw = parent?.raw;
    if (parent && !parentRaw) {
      throw new Error('parent span carries no OpenTelemetry handle');
    }
    const context = parentRaw
      ? this.api.trace.setSpan(this.api.context.active(), parentRaw)
      : undefined;
    return new OtelSpan(
      this.api,
      this.raw.startSpan(name, { attributes: options?.attributes }, context),
    );
  }
}

export interface CreateTracingOptions {
  /** Every OTEL_* setting is read from here, endpoint and resource included;
   * defaults to process.env. */
  env?: Env;
  /** Test seam: replaces the OTLP exporter. */
  spanExporter?: SpanExporter;
}

// The OpenTelemetry packages are imported here and nowhere else, so a disabled
// run never loads them.
export async function createTracing(
  options: CreateTracingOptions = {},
): Promise<Tracing> {
  const env = options.env ?? process.env;
  if (!isTracingEnabled(env)) {
    return {
      enabled: false,
      tracer: NOOP_TRACER,
      flush: async () => {},
      shutdown: async () => {},
    };
  }
  assertSupportedProtocol(env);

  const api = await import('@opentelemetry/api');
  const { TracerProvider, BatchSpanProcessor } = await import(
    '@opentelemetry/sdk-trace'
  );
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { OTLPTraceExporter } = await import(
    '@opentelemetry/exporter-trace-otlp-proto'
  );
  const exporter =
    options.spanExporter ??
    new OTLPTraceExporter({
      url: otlpTracesUrl(env),
      headers: otlpHeaders(env),
    });

  const resource = resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': VERSION,
  }).merge(resourceFromAttributes(resourceAttributesFromEnv(env)));

  const provider = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter,
        // The default queue (2048) drops spans silently when the collector is
        // slow or unreachable; long batches make thousands of batch spans that
        // must survive to keep the trace complete.
        maxQueueSize: 8192,
      }),
    ],
  });
  return {
    enabled: true,
    tracer: new OtelTracer(api, provider.getTracer(SERVICE_NAME, VERSION)),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  };
}
