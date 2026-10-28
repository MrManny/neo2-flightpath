import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';

import { VERSION } from '../src/version.js';
import {
  NOOP_TRACER,
  createTracing,
  isTracingEnabled,
  withSpan,
} from '../src/tracing.js';
import { OTLP_ENDPOINT as ENDPOINT, tracingHarness } from './fixtures.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

it.for([
  { name: 'no OTEL_* variables', env: {}, want: false },
  {
    name: 'OTEL_EXPORTER_OTLP_ENDPOINT set',
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
    want: true,
  },
  {
    name: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT set',
    env: { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${ENDPOINT}/v1/traces` },
    want: true,
  },
  {
    name: 'both endpoints set',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${ENDPOINT}/v1/traces`,
    },
    want: true,
  },
  {
    name: 'endpoint + OTEL_SDK_DISABLED=true',
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_SDK_DISABLED: 'true' },
    want: false,
  },
  {
    name: 'endpoint + OTEL_SDK_DISABLED=TRUE',
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_SDK_DISABLED: 'TRUE' },
    want: false,
  },
  {
    name: 'endpoint + OTEL_SDK_DISABLED=false',
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, OTEL_SDK_DISABLED: 'false' },
    want: true,
  },
  {
    name: 'empty endpoint value',
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: '  ' },
    want: false,
  },
])('isTracingEnabled: $name', ({ env, want }) => {
  expect(isTracingEnabled(env)).toBe(want);
});

describe('createTracing (disabled)', () => {
  it('returns a no-op tracer and exports nothing', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({ env: {}, spanExporter: exporter });
    expect(tracing.enabled).toBe(false);
    expect(tracing.tracer).toBe(NOOP_TRACER);

    const span = tracing.tracer.startSpan('recording.process');
    span.setAttribute('source.file.name', 'clip.mp4');
    span.fail(new Error('boom'));
    span.end();
    const result = await withSpan(tracing.tracer, 'probe', {}, async () => 42);
    await tracing.shutdown();

    expect(result).toBe(42);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('never loads an OpenTelemetry package', async () => {
    const loaded: string[] = [];
    const packages = [
      '@opentelemetry/api',
      '@opentelemetry/sdk-trace',
      '@opentelemetry/resources',
      '@opentelemetry/exporter-trace-otlp-proto',
    ];
    vi.resetModules();
    for (const pkg of packages) {
      vi.doMock(pkg, () => {
        loaded.push(pkg);
        throw new Error(`${pkg} must not be loaded`);
      });
    }
    try {
      const fresh = await import('../src/tracing.js');
      const tracing = await fresh.createTracing({ env: {} });
      const span = tracing.tracer.startSpan('recording.process');
      span.end();
      await withSpan(tracing.tracer, 'probe', {}, async () => {});
      await tracing.shutdown();
    } finally {
      for (const pkg of packages) vi.doUnmock(pkg);
      vi.resetModules();
    }
    expect(loaded).toEqual([]);
  });
});

describe('createTracing (enabled)', () => {
  it('exports spans with parenting, attributes and failures', async () => {
    const h = await tracingHarness();
    expect(h.tracing.enabled).toBe(true);

    const root = h.tracer.startSpan('recording.process', {
      attributes: { 'source.file.name': 'clip.mp4' },
    });
    await withSpan(h.tracer, 'probe', { parent: root }, async (span) => {
      span.setAttribute('source.frames', 3);
    });
    await withSpan(
      h.tracer,
      'telemetry.load',
      { parent: root },
      async () => {
        throw new Error('no telemetry found');
      },
    ).catch(() => {});
    root.end();
    const spans = await h.finish();
    const rootSpan = spans.find((s) => s.name === 'recording.process');
    const probe = spans.find((s) => s.name === 'probe');
    const tel = spans.find((s) => s.name === 'telemetry.load');
    expect(rootSpan).toBeDefined();
    expect(probe).toBeDefined();
    expect(tel).toBeDefined();

    expect(probe?.parentSpanContext?.spanId).toBe(rootSpan?.spanContext().spanId);
    expect(tel?.parentSpanContext?.spanId).toBe(rootSpan?.spanContext().spanId);

    expect(rootSpan?.attributes['source.file.name']).toBe('clip.mp4');
    expect(probe?.attributes['source.frames']).toBe(3);

    expect(probe?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(tel?.status.code).toBe(SpanStatusCode.ERROR);
    expect(tel?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('records non-Error failures as exceptions too', async () => {
    const h = await tracingHarness();
    await withSpan(h.tracer, 'probe', {}, async () => {
      throw 'string failure';
    }).catch(() => {});
    const [span] = await h.finish();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('carries service.name and service.version on every span resource', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', ENDPOINT);
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({ spanExporter: exporter });
    const span = tracing.tracer.startSpan('recording.process');
    span.end();
    await tracing.flush();
    const [finished] = exporter.getFinishedSpans();
    await tracing.shutdown();
    expect(finished.resource.attributes['service.name']).toBe('neo2-flightpath');
    expect(finished.resource.attributes['service.version']).toBe(VERSION);
  });

  it('lets OTEL_SERVICE_NAME override the service name', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', ENDPOINT);
    vi.stubEnv('OTEL_SERVICE_NAME', 'custom-service');
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({ spanExporter: exporter });
    const span = tracing.tracer.startSpan('recording.process');
    span.end();
    await tracing.flush();
    const [finished] = exporter.getFinishedSpans();
    await tracing.shutdown();
    expect(finished.resource.attributes['service.name']).toBe('custom-service');
  });
});

it.for([
  {
    name: 'OTEL_EXPORTER_OTLP_PROTOCOL',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
    },
    want: /unsupported OTEL_EXPORTER_OTLP_PROTOCOL: grpc/,
  },
  {
    name: 'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
    },
    want: /unsupported OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: http\/json/,
  },
  {
    name: 'the traces protocol overriding a supported generic one',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'grpc',
    },
    want: /unsupported OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: grpc/,
  },
])('unsupported effective protocol via $name fails fast', async ({ env, want }) => {
  await expect(
    createTracing({ env, spanExporter: new InMemorySpanExporter() }),
  ).rejects.toThrow(want);
});

it.for([
  {
    name: 'explicit http/protobuf',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    },
  },
  {
    name: 'the traces protocol winning over an unsupported generic one',
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
    },
  },
])('supported effective protocol via $name is accepted', async ({ env }) => {
  const tracing = await createTracing({
    env,
    spanExporter: new InMemorySpanExporter(),
  });
  expect(tracing.enabled).toBe(true);
  await tracing.shutdown();
});
