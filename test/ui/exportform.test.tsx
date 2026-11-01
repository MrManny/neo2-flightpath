// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportFormProps } from '../../ui/components/ExportForm.js';
import { ExportForm } from '../../ui/components/ExportForm.js';
import type { ExportForm as ExportFormState } from '../../ui/lib/exportstate.js';

afterEach(cleanup);

const FORM: ExportFormState = { outPath: null, width: 768, height: 768, range: null };
const SEGMENT = { range: { start: 300, end: 360 }, label: '0:10–0:12 · 61 frames' };

function renderForm(overrides: Partial<ExportFormProps> = {}) {
  const dispatch = overrides.dispatch ?? vi.fn();
  render(
    <ExportForm
      form={FORM}
      segment={null}
      totalText="0:34"
      error={null}
      onClose={vi.fn()}
      onStart={vi.fn()}
      {...overrides}
      dispatch={dispatch}
    />,
  );
  return { dispatch };
}

describe('ExportForm what-to-export choice', () => {
  it('stays out of the way without an engaged loop', () => {
    renderForm();
    expect(screen.queryByRole('group', { name: 'What' })).toBeNull();
  });

  it('offers the full recording and the segment with an engaged loop', () => {
    renderForm({ segment: SEGMENT });
    expect(screen.getByRole('radio', { name: /Full recording \(0:34\)/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /In–Out segment \(0:10–0:12 · 61 frames\)/ })).toBeTruthy();
  });

  it('reports the segment choice back to the form state', () => {
    const { dispatch } = renderForm({ segment: SEGMENT });
    fireEvent.click(screen.getByRole('radio', { name: /In–Out segment/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setRange', range: SEGMENT.range });
  });

  it('reports the full-recording choice back to the form state', () => {
    const { dispatch } = renderForm({
      segment: SEGMENT,
      form: { ...FORM, range: SEGMENT.range },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Full recording/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setRange', range: null });
  });
});

describe('ExportForm dimensions', () => {
  it('shows the px hint on both fields', () => {
    renderForm();
    expect(screen.getByLabelText('Width')).toBeTruthy();
    expect(screen.getByLabelText('Height')).toBeTruthy();
    expect(screen.getAllByText('px')).toHaveLength(2);
  });

  it('commits a valid width through the dispatch', () => {
    const { dispatch } = renderForm();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '800' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setWidth', width: 800 });
    expect(screen.queryByText('Must be at least 64 px.')).toBeNull();
  });

  it('rejects a width below the minimum with the rule message', () => {
    const { dispatch } = renderForm();
    const width = screen.getByLabelText('Width') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '10' } });
    expect(screen.getByText('Must be at least 64 px.')).toBeTruthy();
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('ExportForm actions', () => {
  it('offers Cancel and Start export', () => {
    const onClose = vi.fn();
    const onStart = vi.fn();
    renderForm({ onClose, onStart });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows a failure message above the actions', () => {
    renderForm({ error: 'the app backend went away' });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
  });
});
