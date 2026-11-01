// The shared value vocabulary of a recording's telemetry summary: one mapping
// from Telemetry, consumed by the batch summary and the CLI log line, so their
// numbers cannot drift apart.

import type {
  HeadingMode,
  Telemetry,
  TelemetryMethod,
  TelemetrySource,
} from './telemetry.js';

export interface TelemetrySummary {
  source: TelemetrySource;
  method: TelemetryMethod;
  headingMode: HeadingMode;
  fixes: number;
  noLock: number;
  /** Meters, rounded the way every user-facing surface reports them. */
  trackDistanceM: number;
}

export function telemetrySummary(tel: Telemetry): TelemetrySummary {
  return {
    source: tel.source,
    method: tel.method,
    headingMode: tel.headingMode,
    fixes: tel.fixCount,
    noLock: tel.noLock,
    trackDistanceM: Math.round(tel.trackDistanceM),
  };
}

export function fixesLabel(fixes: number): string {
  return `${fixes} fixes`;
}

export function noLockCuesLabel(noLock: number): string {
  return `${noLock} no-lock cues`;
}

export function trackDistanceLabel(trackDistanceM: number): string {
  return `${trackDistanceM} m`;
}
