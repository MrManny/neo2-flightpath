// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingPanel } from '../../ui/components/LandingPanel.js';
import { START_PREPARE_PROGRESS } from '../../ui/lib/pickstate.js';
import type { PickState } from '../../ui/lib/pickstate.js';

afterEach(cleanup);

describe('LandingPanel', () => {
  it('offers the pick flow when idle', () => {
    render(<LandingPanel state={{ kind: 'idle' }} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open…' })).toBeTruthy();
    expect(screen.getByText(/SRT sidecar/)).toBeTruthy();
  });

  it('keeps the status line empty while the native picker is open', () => {
    render(<LandingPanel state={{ kind: 'picking' }} onPick={() => {}} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open…' });
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the loading bar and the first stage once the file is being prepared', () => {
    render(
      <LandingPanel
        state={{ kind: 'preparing', progress: START_PREPARE_PROGRESS }}
        onPick={() => {}}
      />,
    );
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Probing the recording…')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('counts the warmed tiles during the pre-warm', () => {
    render(
      <LandingPanel
        state={{
          kind: 'preparing',
          progress: { stage: 'tiles', done: 15, total: 51, tilesDone: 12, tilesTotal: 48 },
        }}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText('Warming tiles… 12/48')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Preparation progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('29');
  });

  it('reports a cancel', () => {
    render(<LandingPanel state={{ kind: 'canceled' }} onPick={() => {}} />);
    expect(screen.getByText('No recording picked.')).toBeTruthy();
  });

  it('reports failures with their message', () => {
    render(<LandingPanel state={{ kind: 'error', message: 'boom' }} onPick={() => {}} />);
    expect(screen.getByText('Could not open the recording: boom')).toBeTruthy();
  });

  it('turns a known failure into a sentence and keeps the original as details', () => {
    render(
      <LandingPanel
        state={{ kind: 'error', message: 'not a readable .mp4 file: C:\\Windows\\win.ini' }}
        onPick={() => {}}
      />,
    );
    expect(
      screen.getByText('Could not open the recording: "win.ini" is not a readable .mp4 recording.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText('not a readable .mp4 file: C:\\Windows\\win.ini')).toBeTruthy();
  });

  it('dismisses a failure through its notice', async () => {
    const onDismiss = vi.fn();
    render(
      <LandingPanel state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onDismiss={onDismiss} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('invokes onPick on click', async () => {
    const onPick = vi.fn();
    render(<LandingPanel state={{ kind: 'idle' }} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open…' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe.each<PickState>([{ kind: 'idle' }, { kind: 'picking' }, { kind: 'ready' }])(
  'a landing in the $kind state',
  (state) => {
    it('shows no status line', () => {
      render(<LandingPanel state={state} onPick={() => {}} />);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  },
);
