'use client';

import { useEffect, useReducer } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import { MIN_DIMENSION, validateDimensions } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import { appBridge } from '../lib/backend.js';
import { describeError } from '../lib/errortext.js';
import { captureFraction, exportReducer, initialExportState } from '../lib/exportstate.js';
import { formatFrameRate } from '../lib/framerate.js';
import { engagedLoop, formatFrameRange, formatTime } from '../lib/framedriver.js';
import type { LoopState } from '../lib/framedriver.js';
import { DialogShell } from './DialogShell.js';
import { Notice } from './Notice.js';
import { NumberField } from './NumberField.js';

// The modal's dimensions go through the same rule the CLI and pipeline apply.
function dimensionsValid(width: number, height: number): boolean {
  try {
    validateDimensions(width, height);
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

export function ExportModal({
  session,
  settings,
  loop,
  onClose,
  onBusyChange,
}: ExportModalProps) {
  const { video, stats } = session;
  const [state, dispatch] = useReducer(
    exportReducer,
    initialExportState(settings.width, settings.height),
  );
  const loopPoints = engagedLoop(loop);
  const busy = state.phase === 'running';
  const fraction = captureFraction(state.messages);
  const percent = Math.round((fraction ?? 0) * 100);

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

  // Export asks for the destination first: the native save dialog is the only
  // place a path comes from, and cancelling it cancels the export.
  const chooseAndExport = async (): Promise<void> => {
    let outPath: string;
    try {
      const picked = await appBridge().pickExportOutput();
      if (!picked.ok || !picked.path) {
        if (picked.error) dispatch({ type: 'failed', error: picked.error });
        return;
      }
      outPath = picked.path;
    } catch (e) {
      dispatch({ type: 'failed', error: errorMessage(e) });
      return;
    }
    dispatch({ type: 'choose', path: outPath });
    // The snapshot is frozen here: the job runs this request however the
    // preview settings move afterwards.
    const request: ExportRequest = {
      outPath,
      config: { ...settings, width: state.form.width, height: state.form.height },
      // A segment only exists while its loop is engaged; a stale choice never
      // exports frames the user can no longer see marked.
      range: segment ? state.form.range : null,
    };
    dispatch({ type: 'start', request });
    try {
      const ack = await appBridge().startExport(request);
      if (!ack.ok) {
        dispatch({ type: 'startFailed', error: ack.error ?? 'export could not start' });
      }
    } catch (e) {
      dispatch({ type: 'startFailed', error: errorMessage(e) });
    }
  };

  const cancelExport = (): void => {
    dispatch({ type: 'cancelRequested' });
    void (async () => {
      try {
        const ack = await appBridge().cancelExport();
        if (!ack.ok) {
          dispatch({ type: 'cancelFailed', error: ack.error ?? 'export could not be canceled' });
        }
      } catch (e) {
        dispatch({ type: 'cancelFailed', error: errorMessage(e) });
      }
    })();
  };

  const runOnBridge = (
    fn: (bridge: NonNullable<Window['neo2flightpath']>) => Promise<{ ok: boolean; error?: string }>,
  ): void => {
    dispatch({ type: 'clearError' });
    void (async () => {
      try {
        const ack = await fn(appBridge());
        if (!ack.ok) dispatch({ type: 'failed', error: ack.error ?? 'action failed' });
      } catch (e) {
        dispatch({ type: 'failed', error: errorMessage(e) });
      }
    })();
  };

  const { phase, form, result, error, canceling } = state;
  // The one duration definition: the stats chip and the export form agree.
  const totalText = formatTime(stats.durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: { start: loopPoints.in, end: loopPoints.out },
        label: formatFrameRange(loopPoints, video.fps),
      }
    : null;
  const errorText = error === null ? null : describeError(error);

  return (
    <DialogShell
      title="Export"
      onClose={onClose}
      closeOnBackdrop={!busy}
      blockedReason={busy ? 'Export is running. Cancel it to close.' : undefined}
    >
      {phase === 'form' ? (
        <>
          {/* With no engaged loop there is nothing to choose: the export is
              the full recording and the choice stays out of the way. */}
          {segment ? (
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
                  onChange={() => dispatch({ type: 'setRange', range: segment.range })}
                />
                <span>In–Out segment ({segment.label})</span>
              </label>
            </fieldset>
          ) : null}

          <fieldset className="settings-group">
            <legend>How</legend>
            <NumberField
              label="Width"
              value={form.width}
              min={MIN_DIMENSION}
              rule={`at least ${MIN_DIMENSION} px`}
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
              min={MIN_DIMENSION}
              rule={`at least ${MIN_DIMENSION} px`}
              hint="px"
              onValue={(height) => {
                if (!dimensionsValid(form.width, height)) return false;
                dispatch({ type: 'setHeight', height });
                return true;
              }}
            />
          </fieldset>

          {errorText ? (
            <Notice tone="danger" details={errorText.technical}>
              {errorText.text}
            </Notice>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="export-primary"
              onClick={() => void chooseAndExport()}
            >
              Start export
            </button>
          </div>
        </>
      ) : null}

      {phase === 'running' ? (
        <>
          <div className="export-progress">
            <div
              className="export-progress-track"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className="export-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="export-progress-label">
              {canceling
                ? 'Canceling…'
                : fraction === null
                  ? 'Preparing…'
                  : `Rendering ${percent}%`}
            </div>
          </div>
          {errorText ? (
            <Notice tone="danger" details={errorText.technical}>
              {errorText.text}
            </Notice>
          ) : null}
          <div className="dialog-actions">
            <button
              type="button"
              onClick={cancelExport}
              disabled={canceling}
            >
              Cancel export
            </button>
          </div>
        </>
      ) : null}

      {phase === 'done' && result ? (
        <>
          {errorText ? (
            <Notice tone="danger" details={errorText.technical}>
              {errorText.text}
            </Notice>
          ) : null}
          <Notice tone="info">
            {`${result.frames} frames @ ${formatFrameRate(result.fps ?? '')} · ${Math.round(result.elapsedSec)} s · ${result.width}×${result.height}`}
          </Notice>
          <p className="export-path">{result.out}</p>
          <div className="dialog-actions">
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
              Open video
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}

      {phase === 'canceled' ? (
        <>
          <Notice tone="info">Export canceled; its working file was removed.</Notice>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}

      {phase === 'error' && errorText ? (
        <>
          <Notice tone="danger" details={errorText.technical}>
            {`${errorText.text} The destination file was left untouched.`}
          </Notice>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </DialogShell>
  );
}
