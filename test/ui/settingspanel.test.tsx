// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { SettingsPanel } from '../../ui/components/SettingsPanel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(
  config: RenderConfig,
  hasAltitude: boolean,
  onChange: (config: RenderConfig) => void = () => {},
) {
  return render(
    <SettingsPanel
      config={config}
      hasAltitude={hasAltitude}
      onChange={onChange}
      onClose={() => {}}
    />,
  );
}

describe('SettingsPanel', () => {
  it('shows the current values of every knob', () => {
    const config: RenderConfig = {
      ...DEFAULT_CONFIG,
      style: 'topo',
      view: 'overview',
      zoom: 13,
      zoomOut: 2,
      introSec: 1.5,
    };
    renderPanel(config, true);
    expect(screen.getByLabelText<HTMLSelectElement>('Map style').value).toBe('topo');
    expect(screen.getByLabelText<HTMLSelectElement>('View').value).toBe('overview');
    expect(screen.getByLabelText<HTMLInputElement>('Zoom').value).toBe('13');
    expect(screen.getByLabelText<HTMLInputElement>('Zoom-out').value).toBe('2');
    expect(screen.getByLabelText<HTMLInputElement>('Intro (s)').value).toBe('1.5');
    expect(screen.getByLabelText<HTMLInputElement>('Outro (s)').value).toBe('2');
  });

  it('shows plain option labels while keeping raw values', () => {
    renderPanel(DEFAULT_CONFIG, true);
    const mapStyle = screen.getByLabelText<HTMLSelectElement>('Map style');
    expect([...mapStyle.options].map((o) => [o.value, o.textContent])).toEqual([
      ['satellite', 'Satellite'],
      ['topo', 'Topographic'],
    ]);
    const view = screen.getByLabelText<HTMLSelectElement>('View');
    expect([...view.options].map((o) => [o.value, o.textContent])).toEqual([
      ['follow', 'Follow'],
      ['overview', 'Overview'],
    ]);
  });

  it('closes from the header Close button, which is never blocked here', () => {
    const onClose = vi.fn();
    render(
      <SettingsPanel
        config={DEFAULT_CONFIG}
        hasAltitude
        onChange={() => {}}
        onClose={onClose}
      />,
    );
    const close = screen.getByRole<HTMLButtonElement>('button', { name: 'Close' });
    expect(close.disabled).toBe(false);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('emits the vocabulary values on control changes', () => {
    const onChange = vi.fn();
    renderPanel(DEFAULT_CONFIG, true, onChange);
    fireEvent.change(screen.getByLabelText('Map style'), {
      target: { value: 'topo' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ style: 'topo' }),
    );
    fireEvent.click(screen.getByLabelText('Speed (SPD)'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hud: { heading: true, alt: false, speed: true },
      }),
    );
  });

  it('rejects values the CLI would reject instead of emitting them', () => {
    const onChange = vi.fn();
    renderPanel(DEFAULT_CONFIG, true, onChange);
    fireEvent.change(screen.getByLabelText('Intro (s)'), {
      target: { value: '-1' },
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Intro (s)'), {
      target: { value: '' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a rejected value visible with its message until blur, then reverts', () => {
    function Harness() {
      const [current, setCurrent] = useState(DEFAULT_CONFIG);
      return (
        <SettingsPanel
          config={current}
          hasAltitude
          onChange={setCurrent}
          onClose={() => {}}
        />
      );
    }
    render(<Harness />);
    const intro = screen.getByLabelText<HTMLInputElement>('Intro (s)');

    fireEvent.change(intro, { target: { value: '-1' } });
    expect(intro.value).toBe('-1');
    expect(intro.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Must be 0 or more.')).toBeTruthy();

    fireEvent.blur(intro);
    expect(intro.value).toBe('2');
    expect(intro.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Must be 0 or more.')).toBeNull();

    fireEvent.change(intro, { target: { value: '1.5' } });
    expect(intro.value).toBe('1.5'); // the committed value stays editable
  });

  it('shows the effective chip state when the alt chip cannot render', () => {
    renderPanel(
      { ...DEFAULT_CONFIG, hud: { heading: true, alt: true, speed: false } },
      false,
    );
    const alt = screen.getByLabelText<HTMLInputElement>('Altitude (ALT)');
    expect(alt.checked).toBe(false); // the chip would not show
    expect(alt.disabled).toBe(true);
  });

  it('disables the alt chip toggle when the telemetry has no altitude', () => {
    const { rerender } = renderPanel(DEFAULT_CONFIG, false);
    const alt = screen.getByLabelText<HTMLInputElement>('Altitude (ALT)');
    expect(alt.disabled).toBe(true);
    rerender(
      <SettingsPanel
        config={DEFAULT_CONFIG}
        hasAltitude
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(alt.disabled).toBe(false);
  });
});

describe.each([{ field: 'Zoom' }, { field: 'Zoom-out' }, { field: 'Intro (s)' }, { field: 'Outro (s)' }])(
  '$field rejects a negative value',
  ({ field }) => {
    it('names the rule, marks the field invalid and emits nothing', () => {
      const onChange = vi.fn();
      renderPanel(DEFAULT_CONFIG, true, onChange);
      const input = screen.getByLabelText<HTMLInputElement>(field);
      fireEvent.change(input, { target: { value: '-1' } });
      expect(screen.getByText('Must be 0 or more.')).toBeTruthy();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(onChange).not.toHaveBeenCalled();
    });
  },
);

describe.each([
  { hasAltitude: true, note: false },
  { hasAltitude: false, note: true },
])('HUD altitude note when hasAltitude is $hasAltitude', ({ hasAltitude, note }) => {
  it('explains the missing ALT chip only when the telemetry has no altitude', () => {
    renderPanel(DEFAULT_CONFIG, hasAltitude);
    const text = 'This recording has no altitude telemetry, so the ALT chip stays off.';
    expect(screen.queryByText(text) !== null).toBe(note);
  });
});
