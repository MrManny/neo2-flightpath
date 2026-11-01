'use client';

import type { FrameRange } from '../../src/config.js';
import { MIN_DIMENSION, validateDimensions } from '../../src/config.js';
import type { ExportEvent, ExportForm as ExportFormState } from '../lib/exportstate.js';
import { ErrorNotice } from './ErrorNotice.js';
import { NumberField } from './NumberField.js';

export interface ExportFormProps {
  form: ExportFormState;
  /** The engaged loop's segment, or null while only the full recording exists. */
  segment: { range: FrameRange; label: string } | null;
  totalText: string;
  error: string | null;
  dispatch: (event: ExportEvent) => void;
  onClose: () => void;
  onStart: () => void;
}

// The modal's dimensions go through the same rule the CLI and pipeline apply.
function dimensionsValid(width: number, height: number): boolean {
  try {
    validateDimensions(width, height);
    return true;
  } catch {
    return false;
  }
}

export function ExportForm({
  form,
  segment,
  totalText,
  error,
  dispatch,
  onClose,
  onStart,
}: ExportFormProps) {
  return (
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
        <button type="button" className="export-primary" onClick={onStart}>
          Start export
        </button>
      </div>
    </>
  );
}
