// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingPanel } from '../../ui/components/LandingPanel.js';

afterEach(cleanup);

describe('LandingPanel', () => {
  it('offers the pick flow when idle', () => {
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open recording…' })).toBeTruthy();
    expect(screen.getByText(/SRT sidecar/)).toBeTruthy();
  });

  it('shows progress and blocks re-entry while busy', () => {
    render(<LandingPanel state={{ kind: 'busy' }} onPick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Preparing the recording/)).toBeTruthy();
  });

  it('reports a cancel', () => {
    render(<LandingPanel state={{ kind: 'canceled' }} onPick={() => {}} />);
    expect(screen.getByText('No recording picked.')).toBeTruthy();
  });

  it('reports failures with their message', () => {
    render(<LandingPanel state={{ kind: 'error', message: 'boom' }} onPick={() => {}} />);
    expect(screen.getByText('Could not open the recording: boom')).toBeTruthy();
  });

  it('invokes onPick on click', async () => {
    const onPick = vi.fn();
    render(<LandingPanel state={{ kind: 'idle' }} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open recording…' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
