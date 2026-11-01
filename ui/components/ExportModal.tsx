'use client';

import { useEffect, useReducer } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { ExportRequest, FrameRange, RenderConfig } from '../../src/config.js';
import { MIN_DIMENSION, validateDimensions } from '../../src/config.js';
import { errorMessage } from '../../src/errors.js';
import { appBridge } from '../lib/backend.js';
import type { DialogRunEvent } from '../lib/dialogstate.js';
import { captureFraction, exportReducer, initialExportState } from '../lib/exportstate.js';
import { formatFrameRate } from '../lib/framerate.js';
import { engagedLoop, formatFrameRange, formatTime } from '../lib/framedriver.js';
import type { LoopState } from '../lib/framedriver.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';
import { NumberField } from './NumberField.js';
import { ProgressBar } from './ProgressBar.js';

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
  /** From the dialog state machine: a running job pins the dialog open. */
  dismissible: boolean;
  /** Feeds the dialog state machine the job's lifecycle. */
  onRunEvent: (event: DialogRunEvent) => void;
}

export function ExportModal({
  session,
  settings,
  loop,
  onClose,
  dismissible,
  onRunEvent,
}: ExportModalProps) {
  const { video, durationSec } = session;
  const [state, dispatch] = useReducer(
    exportReducer,
    initialExportState(settings.width, settings.height),
  );
  const loopPoints = engagedLoop(loop);
  const busy = state.phase === 'running';
  const fraction = captureFraction(state.messages);
  const percent = Math.round((fraction ?? 0) * 100);

  useEffect(() => {
    if (busy) onRunEvent({ type: 'exportStarted' });
    return () => {
      if (busy) onRunEvent({ type: 'exportFinished' });
    };
  }, [busy, onRunEvent]);

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

  const { phase, form, result, error, canceling } = state;
  const totalText = formatTime(durationSec);
  const segment: { range: FrameRange; label: string } | null = loopPoints
    ? {
        range: { start: loopPoints.in, end: loopPoints.out },
        label: formatFrameRange(loopPoints, video.fps),
      }
    : null;

  // The destination comes from the native save dialog; cancelling it
  // cancels the export.
  const pickDestination = async (): Promise<string | null> => {
    try {
      const picked = await appBridge().pickExportOutput();
      if (!picked.ok || !picked.path) {
        if (picked.error) dispatch({ type: 'failed', error: picked.error });
        return null;
      }
      return picked.path;
    } catch (e) {
      dispatch({ type: 'failed', error: errorMessage(e) });
      return null;
    }
  };

  // The snapshot is frozen here: the job runs this request however the
  // preview settings move afterwards. A segment only exists while its loop is
  // engaged; a stale choice never exports frames the user can no longer see
  // marked.
  const buildRequest = (outPath: string): ExportRequest => ({
    outPath,
    config: { ...settings, width: form.width, height: form.height },
    range: segment ? form.range : null,
  });

  const startJob = async (request: ExportRequest): Promise<void> => {
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

  const chooseAndExport = async (): Promise<void> => {
    const outPath = await pickDestination();
    if (outPath === null) return;
    dispatch({ type: 'choose', path: outPath });
    await startJob(buildRequest(outPath));
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

  return (
    <DialogShell
      title="Export"
      onClose={onClose}
      closeOnBackdrop={dismissible}
      blockedReason={dismissible ? undefined : 'Export is running. Cancel it to close.'}
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

          {error ? <ErrorNotice message={error} /> : null}
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
            <ProgressBar label="Export progress" percent={percent} />
            <div className="progress-label">
              {canceling
                ? 'Canceling…'
                : fraction === null
                  ? 'Preparing…'
                  : `Rendering ${percent}%`}
            </div>
          </div>
          {error ? <ErrorNotice message={error} /> : null}
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
          {error ? <ErrorNotice message={error} /> : null}
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

      {phase === 'error' && error ? (
        <>
          <ErrorNotice message={error} tail="The destination file was left untouched." />
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
