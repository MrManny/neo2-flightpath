'use client';

import { useEffect, useReducer } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import { appBridge } from '../lib/backend.js';
import { engagedLoop, formatTime } from '../lib/framedriver.js';
import type { LoopState } from '../lib/framedriver.js';
import { exportReducer, initialExportState } from '../lib/exportstate.js';
import { DEFAULT_CONFIG, validateRenderConfig } from '../../src/config.js';
import { CloseIcon } from '../icons/CloseIcon.js';
import { NumberField } from './NumberField.js';

// The modal's dimensions go through the same validation the CLI applies.
function dimensionsValid(width: number, height: number): boolean {
  try {
    validateRenderConfig({ ...DEFAULT_CONFIG, width, height });
    return true;
  } catch {
    return false;
  }
}

export interface ExportModalProps {
  session: UiSession;
  settings: RenderConfig;
  loop: LoopState;
  onClose: () => void;
  /** Tells the player whether the modal may be dismissed (not while a job runs). */
  onBusyChange: (busy: boolean) => void;
}

const LOG_TAIL = 8;

export function ExportModal({
  session,
  settings,
  loop,
  onClose,
  onBusyChange,
}: ExportModalProps) {
  const { video } = session;
  const [state, dispatch] = useReducer(
    exportReducer,
    initialExportState(settings.width, settings.height),
  );
  const loopPoints = engagedLoop(loop);
  const busy = state.phase === 'running';

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    let offProgress: (() => void) | null = null;
    let offDone: (() => void) | null = null;
    try {
      const bridge = appBridge();
      offProgress = bridge.onExportProgress((message) =>
        dispatch({ type: 'progress', message }),
      );
      offDone = bridge.onExportDone((outcome) => dispatch({ type: 'finish', outcome }));
    } catch {
      // Outside the app shell there is no backend: the form still renders.
    }
    return () => {
      offProgress?.();
      offDone?.();
    };
  }, []);

  const chooseOut = async (): Promise<void> => {
    try {
      const result = await appBridge().pickExportOutput();
      if (result.ok && result.path) dispatch({ type: 'choose', path: result.path });
      else if (result.error) dispatch({ type: 'failed', error: result.error });
    } catch (e) {
      dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const startExport = (): void => {
    const outPath = state.form.outPath;
    if (!outPath) return;
    // The snapshot is frozen here: the job runs this request however the
    // preview settings move afterwards.
    const request: ExportRequest = {
      outPath,
      config: { ...settings, width: state.form.width, height: state.form.height },
      range: state.form.range,
    };
    dispatch({ type: 'start', request });
    void (async () => {
      try {
        const ack = await appBridge().startExport(request);
        if (!ack.ok) {
          dispatch({ type: 'startFailed', error: ack.error ?? 'export could not start' });
        }
      } catch (e) {
        dispatch({ type: 'startFailed', error: e instanceof Error ? e.message : String(e) });
      }
    })();
  };

  const cancelExport = (): void => {
    dispatch({ type: 'cancelRequested' });
    try {
      void appBridge().cancelExport();
    } catch {
      // nothing to cancel without a backend
    }
  };

  const runOnBridge = (
    fn: (bridge: NonNullable<Window['neo2flightpath']>) => Promise<{ ok: boolean; error?: string }>,
  ): void => {
    void (async () => {
      try {
        const ack = await fn(appBridge());
        if (!ack.ok) dispatch({ type: 'failed', error: ack.error ?? 'action failed' });
      } catch (e) {
        dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    })();
  };

  const { phase, form, messages, result, error, canceling } = state;
  const totalText = formatTime(video.frames / video.fps);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: { start: loopPoints.in, end: loopPoints.out },
        label:
          `${formatTime(loopPoints.in / video.fps)}–${formatTime(loopPoints.out / video.fps)}` +
          ` · ${loopPoints.out - loopPoints.in + 1} frames`,
      }
    : null;

  return (
    <div
      className="settings-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-label="Export"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Export</h2>
          {!busy ? (
            <button type="button" onClick={onClose} aria-label="Close" title="Close">
              <CloseIcon />
            </button>
          ) : null}
        </div>

        {phase === 'form' ? (
          <>
            <fieldset className="settings-group">
              <legend>What</legend>
              <label className="settings-row">
                <input
                  type="radio"
                  name="export-range"
                  checked={form.range === null}
                  onChange={() => dispatch({ type: 'setRange', range: null })}
                />
                <span>Full recording ({totalText})</span>
              </label>
              <label className="settings-row">
                <input
                  type="radio"
                  name="export-range"
                  checked={form.range !== null}
                  disabled={!segment}
                  onChange={() => {
                    if (segment) dispatch({ type: 'setRange', range: segment.range });
                  }}
                />
                <span>
                  {segment
                    ? `In–Out segment (${segment.label})`
                    : 'In–Out segment (set loop points first)'}
                </span>
              </label>
            </fieldset>

            <fieldset className="settings-group">
              <legend>How</legend>
              <NumberField
                label="Width"
                value={form.width}
                min={64}
                hint="px"
                onValue={(width) => {
                  if (!dimensionsValid(width, form.height)) return false;
                  dispatch({ type: 'setWidth', width });
                  return true;
                }}
              />
              <NumberField
                label="Height"
                value={form.height}
                min={64}
                hint="px"
                onValue={(height) => {
                  if (!dimensionsValid(form.width, height)) return false;
                  dispatch({ type: 'setHeight', height });
                  return true;
                }}
              />
            </fieldset>

            <fieldset className="settings-group">
              <legend>Where</legend>
              <div className="settings-row">
                <span className="export-path">{form.outPath ?? 'No file chosen'}</span>
                <button type="button" onClick={() => void chooseOut()}>
                  Choose…
                </button>
              </div>
            </fieldset>

            {error ? <p className="hint">{error}</p> : null}
            <div className="settings-row">
              <button type="button" onClick={startExport} disabled={!form.outPath}>
                Export
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {phase === 'running' ? (
          <>
            <div className="settings-row">
              <span>{canceling ? 'Canceling…' : 'Exporting…'}</span>
              <button type="button" onClick={cancelExport} disabled={canceling}>
                Cancel
              </button>
            </div>
            <pre className="export-log">{messages.slice(-LOG_TAIL).join('\n')}</pre>
          </>
        ) : null}

        {phase === 'done' && result ? (
          <>
            <div className="settings-row">
              <span>
                {result.frames} frames @ {result.fps} · {result.elapsedSec} s ·{' '}
                {result.width}×{result.height}
              </span>
            </div>
            <div className="settings-row">
              <span className="export-path">{result.out}</span>
            </div>
            <div className="settings-row">
              <button
                type="button"
                onClick={() => runOnBridge((b) => b.revealExportOutput(result.out))}
              >
                Reveal in folder
              </button>
              <button
                type="button"
                onClick={() => runOnBridge((b) => b.openExportOutput(result.out))}
              >
                Open
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}

        {phase === 'canceled' ? (
          <div className="settings-row">
            <span>Export canceled; its working file was removed.</span>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}

        {phase === 'error' ? (
          <>
            <p className="hint">{error}</p>
            <p className="hint">The destination file was left untouched.</p>
            <div className="settings-row">
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
