// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ControlBarProps } from '../../ui/components/ControlBar.js';
import { ControlBar } from '../../ui/components/ControlBar.js';
import type { HotkeyAction } from '../../ui/lib/hotkeys.js';

afterEach(cleanup);

function renderBar(overrides: Partial<ControlBarProps> = {}) {
  const props: ControlBarProps = {
    dispatch: vi.fn(),
    opening: false,
    ready: true,
    playing: false,
    speed: 1,
    loop: { in: null, out: null },
    fps: 30,
    durationSec: 3,
    maxFrame: 89,
    scrubTo: vi.fn(),
    scrubRef: { current: null },
    timeRef: { current: null },
    onExport: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
  render(<ControlBar {...props} />);
  return props;
}

describe('ControlBar action protocol', () => {
  it.for<{ name: string; action: HotkeyAction }>([
    { name: 'Open…', action: { type: 'openRecording' } },
    { name: 'Play', action: { type: 'togglePlay' } },
    { name: 'Set loop in', action: { type: 'setLoopIn' } },
    { name: 'Set loop out', action: { type: 'setLoopOut' } },
    { name: 'Swap view', action: { type: 'swapView' } },
    { name: '1×', action: { type: 'speed', rate: 1 } },
    { name: '3×', action: { type: 'speed', rate: 3 } },
  ])('$name drives the action map', ({ name, action }) => {
    const props = renderBar();
    fireEvent.click(screen.getByRole('button', { name }));
    expect(props.dispatch).toHaveBeenCalledWith(action);
    expect(props.onExport).not.toHaveBeenCalled();
    expect(props.onSettings).not.toHaveBeenCalled();
  });

  it('drives the action map from Clear when a loop is set', () => {
    const props = renderBar({ loop: { in: 30, out: 60 } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(props.dispatch).toHaveBeenCalledWith({ type: 'clearLoop' });
  });

  it('keeps Export and Settings on their own handlers', () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(props.onSettings).toHaveBeenCalledTimes(1);
    expect(props.dispatch).not.toHaveBeenCalled();
  });

  it('scrubs the timeline through the owner', () => {
    const props = renderBar();
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
      target: { value: '42' },
    });
    expect(props.scrubTo).toHaveBeenCalledWith(42);
    expect(props.dispatch).not.toHaveBeenCalled();
  });
});

describe('ControlBar Clear state', () => {
  it('states why Clear is disabled without any loop point', () => {
    renderBar();
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' });
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute('title')).toBe('No loop to clear.');
  });

  it('clears a half-marked loop', () => {
    renderBar({ loop: { in: 30, out: null } });
    const clear = screen.getByRole<HTMLButtonElement>('button', { name: 'Clear loop' });
    expect(clear.disabled).toBe(false);
    expect(clear.getAttribute('title')).toBe('Clear loop (Esc)');
  });
});

describe('ControlBar readouts', () => {
  it('formats the time readout from raw values', () => {
    renderBar();
    expect(screen.getByText('0:00 / 0:03')).toBeTruthy();
  });

  it('formats the loop readout from raw values', () => {
    renderBar({ loop: { in: 30, out: 60 } });
    expect(screen.getByText('loop 0:01–0:02')).toBeTruthy();
  });

  it('reads a half-marked loop with its unknown end', () => {
    renderBar({ loop: { in: 30, out: null } });
    expect(screen.getByText('loop 0:01–?')).toBeTruthy();
  });

  it('shows no loop readout without points', () => {
    renderBar();
    expect(document.querySelector('.loop-readout')).toBeNull();
  });

  it('bands the engaged loop over the timeline', () => {
    renderBar({ loop: { in: 30, out: 60 } });
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
  });

  it('shows no band for an out-of-order loop', () => {
    renderBar({ loop: { in: 60, out: 30 } });
    expect(document.querySelector('.loop-band')).toBeNull();
  });
});

describe('ControlBar states', () => {
  it('gates Play on tile warm-up', () => {
    renderBar({ ready: false });
    const warmup = screen.getByRole<HTMLButtonElement>('button', { name: 'Warming tiles…' });
    expect(warmup.disabled).toBe(true);
  });

  it('labels the playing state', () => {
    renderBar({ playing: true });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('marks the selected speed segment', () => {
    renderBar({ speed: 2 });
    const group = screen.getByRole('group', { name: 'Playback speed' });
    const pressed = within(group)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
  });
});
