import { describe, expect, it } from 'vitest';

import type { ExportRequest } from '../../src/config.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { captureFraction, exportReducer, initialExportState } from '../../ui/lib/exportstate.js';
import type { ExportState } from '../../ui/lib/exportstate.js';

const REQUEST: ExportRequest = {
  outPath: '/exports/a.mp4',
  config: { ...DEFAULT_CONFIG, width: 1280, height: 720 },
  range: null,
};

const OK_SUMMARY = {
  video: '/v.mp4',
  out: '/exports/a.mp4',
  status: 'ok' as const,
  elapsedSec: 4,
  frames: 120,
  fps: '30',
};

function running(): ExportState {
  const form = exportReducer(initialExportState(768, 768), { type: 'choose', path: '/exports/a.mp4' });
  return exportReducer(form, { type: 'start', request: REQUEST });
}

describe('export form', () => {
  it('starts with the settings dimensions and no destination', () => {
    const state = initialExportState(1280, 720);
    expect(state.form).toEqual({ outPath: null, width: 1280, height: 720, range: null });
    expect(state.phase).toBe('form');
  });

  it('records the chosen destination, dimensions and range', () => {
    let state = initialExportState(768, 768);
    state = exportReducer(state, { type: 'choose', path: '/exports/b.mp4' });
    state = exportReducer(state, { type: 'setWidth', width: 1024 });
    state = exportReducer(state, { type: 'setHeight', height: 576 });
    state = exportReducer(state, { type: 'setRange', range: { start: 3, end: 9 } });
    expect(state.form).toEqual({
      outPath: '/exports/b.mp4',
      width: 1024,
      height: 576,
      range: { start: 3, end: 9 },
    });
  });

  it('ignores form edits while a job runs', () => {
    const state = running();
    expect(exportReducer(state, { type: 'setWidth', width: 2000 }).form.width).toBe(768);
    expect(exportReducer(state, { type: 'choose', path: '/elsewhere.mp4' }).form.outPath).toBe(
      '/exports/a.mp4',
    );
  });
});

describe('export lifecycle', () => {
  it('moves form -> running on start and freezes the request snapshot', () => {
    const state = running();
    expect(state.phase).toBe('running');
    expect(state.request).toBe(REQUEST);
    expect(state.messages).toEqual([]);
  });

  it('accumulates progress lines', () => {
    let state = running();
    state = exportReducer(state, { type: 'progress', message: 'source: flight.mp4' });
    state = exportReducer(state, { type: 'progress', message: 'frames: 100/120 captured' });
    expect(state.messages).toEqual(['source: flight.mp4', 'frames: 100/120 captured']);
  });

  it('finishes to done with the summary on success', () => {
    const state = exportReducer(running(), {
      type: 'finish',
      outcome: { status: 'ok', summary: OK_SUMMARY },
    });
    expect(state.phase).toBe('done');
    expect(state.result).toEqual(OK_SUMMARY);
  });

  it('finishes to error with the message, keeping the form for a retry', () => {
    const state = exportReducer(running(), {
      type: 'finish',
      outcome: { status: 'error', error: 'verification failed' },
    });
    expect(state.phase).toBe('error');
    expect(state.error).toBe('verification failed');
  });

  it('finishes to canceled', () => {
    const cancelling = exportReducer(running(), { type: 'cancelRequested' });
    expect(cancelling.canceling).toBe(true);
    const state = exportReducer(cancelling, { type: 'finish', outcome: { status: 'canceled' } });
    expect(state.phase).toBe('canceled');
    expect(state.canceling).toBe(false);
  });

  it('returns to the form when the start is rejected', () => {
    const state = exportReducer(running(), { type: 'startFailed', error: 'already running' });
    expect(state.phase).toBe('form');
    expect(state.request).toBeNull();
    expect(state.error).toBe('already running');
  });
});

describe('stale events', () => {
  it('ignores a late done after the job already settled', () => {
    const done = exportReducer(running(), {
      type: 'finish',
      outcome: { status: 'ok', summary: OK_SUMMARY },
    });
    const late = exportReducer(done, { type: 'finish', outcome: { status: 'error', error: 'late' } });
    expect(late.phase).toBe('done');
    expect(late.result).toEqual(OK_SUMMARY);
  });

  it('ignores progress that arrives after the job finished', () => {
    const done = exportReducer(running(), {
      type: 'finish',
      outcome: { status: 'canceled' },
    });
    expect(exportReducer(done, { type: 'progress', message: 'late' }).messages).toEqual([]);
  });

  it('ignores a cancel request outside a running job', () => {
    const form = exportReducer(initialExportState(768, 768), { type: 'cancelRequested' });
    expect(form.canceling).toBe(false);
  });
});

describe('cancel failures', () => {
  it('reverts the canceling state and keeps the reason', () => {
    let state = exportReducer(running(), { type: 'cancelRequested' });
    state = exportReducer(state, { type: 'cancelFailed', error: 'export could not be canceled' });
    expect(state.phase).toBe('running');
    expect(state.canceling).toBe(false);
    expect(state.error).toBe('export could not be canceled');
  });

  it('ignores a cancel failure outside a running job', () => {
    const state = exportReducer(initialExportState(768, 768), {
      type: 'cancelFailed',
      error: 'export could not be canceled',
    });
    expect(state.error).toBeNull();
  });

  it('drops the stale reason once the job settles', () => {
    const failed = exportReducer(
      exportReducer(running(), { type: 'cancelRequested' }),
      { type: 'cancelFailed', error: 'export could not be canceled' },
    );
    const done = exportReducer(failed, {
      type: 'finish',
      outcome: { status: 'ok', summary: OK_SUMMARY },
    });
    expect(done.phase).toBe('done');
    expect(done.error).toBeNull();
    const canceled = exportReducer(failed, { type: 'finish', outcome: { status: 'canceled' } });
    expect(canceled.error).toBeNull();
  });

  it('clears a stale error when the next action starts', () => {
    const failed = exportReducer(running(), {
      type: 'cancelFailed',
      error: 'export could not be canceled',
    });
    expect(exportReducer(failed, { type: 'clearError' }).error).toBeNull();
  });
});

describe('capture progress', () => {
  it('stores the latest typed capture progress while a job runs', () => {
    let state = running();
    state = exportReducer(state, { type: 'capture', progress: { done: 100, total: 200 } });
    expect(captureFraction(state.capture)).toBe(0.5);
    state = exportReducer(state, { type: 'capture', progress: { done: 150, total: 200 } });
    expect(captureFraction(state.capture)).toBe(0.75);
  });

  it('resets the capture progress when the next job starts', () => {
    const withCapture = exportReducer(running(), {
      type: 'capture',
      progress: { done: 150, total: 200 },
    });
    const form = exportReducer(withCapture, { type: 'startFailed', error: 'already running' });
    const restarted = exportReducer(form, { type: 'start', request: REQUEST });
    expect(restarted.capture).toBeNull();
  });

  it('ignores capture progress that arrives after the job finished', () => {
    const done = exportReducer(
      exportReducer(running(), { type: 'capture', progress: { done: 150, total: 200 } }),
      { type: 'finish', outcome: { status: 'canceled' } },
    );
    expect(exportReducer(done, { type: 'capture', progress: { done: 1, total: 2 } }).capture).toEqual(
      { done: 150, total: 200 },
    );
  });
});

describe('captureFraction', () => {
  it('derives the fraction from the structured counts', () => {
    expect(captureFraction({ done: 150, total: 200 })).toBe(0.75);
  });

  it('is null before any capture progress arrives', () => {
    expect(captureFraction(null)).toBeNull();
  });

  it('never exceeds 1 and tolerates a zero total', () => {
    expect(captureFraction({ done: 9, total: 5 })).toBe(1);
    expect(captureFraction({ done: 0, total: 0 })).toBeNull();
  });
});
