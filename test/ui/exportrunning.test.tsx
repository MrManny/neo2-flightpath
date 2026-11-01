// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportRunningProps } from '../../ui/components/ExportRunning.js';
import { ExportRunning } from '../../ui/components/ExportRunning.js';

afterEach(cleanup);

function renderRunning(overrides: Partial<ExportRunningProps> = {}) {
  const onCancel = overrides.onCancel ?? vi.fn();
  render(
    <ExportRunning
      fraction={null}
      canceling={false}
      error={null}
      {...overrides}
      onCancel={onCancel}
    />,
  );
  return { onCancel };
}

describe('ExportRunning progress label', () => {
  it('reads Preparing… before any capture progress', () => {
    renderRunning();
    expect(screen.getByText('Preparing…')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('reads Rendering N% from the typed capture fraction', () => {
    renderRunning({ fraction: 0.83 });
    expect(screen.getByText('Rendering 83%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('83');
  });

  it('reads Canceling… while the cancel is in flight', () => {
    renderRunning({ fraction: 0.5, canceling: true });
    expect(screen.getByText('Canceling…')).toBeTruthy();
  });
});

describe('ExportRunning cancel action', () => {
  it('calls back on Cancel export', () => {
    const { onCancel } = renderRunning();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel export while canceling', () => {
    renderRunning({ canceling: true });
    expect(screen.getByRole('button', { name: 'Cancel export' }).disabled).toBe(true);
  });

  it('shows why a cancel failed', () => {
    renderRunning({ error: 'the app backend went away' });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel export' }).disabled).toBe(false);
  });
});
