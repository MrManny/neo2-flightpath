// Export modal state as a pure reducer: form edits, the request snapshot
// frozen at confirm, and the job's lifecycle events. Framework-free so the
// transitions stay unit-testable.

import type { ExportRequest, FrameRange } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { CaptureProgress } from '../../src/render.js';
import type { RecordingSummary } from '../../src/run.js';

export type ExportPhase = 'form' | 'running' | 'done' | 'error' | 'canceled';

// Only the tail is ever shown, so the reducer keeps a bounded window instead
// of copying an ever-growing log on every progress line.
export const LOG_CAP = 50;

// The pipeline reports capture progress as typed counts (not log text), so
// the bar cannot drift from the emitter's wording.
export function captureFraction(capture: CaptureProgress | null): number | null {
  if (!capture) return null;
  return capture.total > 0 ? Math.min(1, capture.done / capture.total) : null;
}

export interface ExportForm {
  outPath: string | null;
  width: number;
  height: number;
  /** null = the full recording. */
  range: FrameRange | null;
}

export interface ExportState {
  phase: ExportPhase;
  form: ExportForm;
  /** Frozen at confirm; later preview changes cannot alter the running job. */
  request: ExportRequest | null;
  messages: string[];
  /** The latest typed capture progress of the running job. */
  capture: CaptureProgress | null;
  result: RecordingSummary | null;
  error: string | null;
  canceling: boolean;
}

export type ExportEvent =
  | { type: 'choose'; path: string }
  | { type: 'setWidth'; width: number }
  | { type: 'setHeight'; height: number }
  | { type: 'setRange'; range: FrameRange | null }
  | { type: 'failed'; error: string }
  | { type: 'start'; request: ExportRequest }
  | { type: 'startFailed'; error: string }
  | { type: 'progress'; message: string }
  | { type: 'capture'; progress: CaptureProgress }
  | { type: 'cancelRequested' }
  | { type: 'cancelFailed'; error: string }
  | { type: 'clearError' }
  | { type: 'finish'; outcome: ExportOutcome };

export function initialExportState(width: number, height: number): ExportState {
  return {
    phase: 'form',
    form: { outPath: null, width, height, range: null },
    request: null,
    messages: [],
    capture: null,
    result: null,
    error: null,
    canceling: false,
  };
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case 'choose':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, outPath: event.path }, error: null }
        : state;
    case 'setWidth':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, width: event.width }, error: null }
        : state;
    case 'setHeight':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, height: event.height }, error: null }
        : state;
    case 'setRange':
      return state.phase === 'form'
        ? { ...state, form: { ...state.form, range: event.range }, error: null }
        : state;
    case 'failed':
      return { ...state, error: event.error };
    case 'start':
      return state.phase === 'form'
        ? {
            ...state,
            phase: 'running',
            request: event.request,
            messages: [],
            capture: null,
            result: null,
            error: null,
            canceling: false,
          }
        : state;
    case 'startFailed':
      return state.phase === 'running'
        ? { ...state, phase: 'form', request: null, error: event.error }
        : state;
    case 'progress':
      return state.phase === 'running'
        ? {
            ...state,
            messages: [...state.messages, event.message].slice(-LOG_CAP),
          }
        : state;
    case 'capture':
      return state.phase === 'running'
        ? { ...state, capture: event.progress }
        : state;
    case 'cancelRequested':
      return state.phase === 'running' ? { ...state, canceling: true, error: null } : state;
    case 'cancelFailed':
      // The job keeps running: the cancel affordance comes back for a retry.
      return state.phase === 'running' ? { ...state, canceling: false, error: event.error } : state;
    case 'clearError':
      return { ...state, error: null };
    case 'finish': {
      // Late events after a terminal state are stale and must not flip it.
      if (state.phase !== 'running') return state;
      const { outcome } = event;
      if (outcome.status === 'ok') {
        return { ...state, phase: 'done', result: outcome.summary, error: null, canceling: false };
      }
      if (outcome.status === 'canceled') {
        return { ...state, phase: 'canceled', error: null, canceling: false };
      }
      return { ...state, phase: 'error', error: outcome.error, canceling: false };
    }
  }
}
