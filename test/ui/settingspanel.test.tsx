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
    expect((screen.getByLabelText('Map style') as HTMLSelectElement).value).toBe('topo');
    expect((screen.getByLabelText('View') as HTMLSelectElement).value).toBe('overview');
    expect((screen.getByLabelText('Zoom') as HTMLInputElement).value).toBe('13');
    expect((screen.getByLabelText('Zoom-out') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Intro (s)') as HTMLInputElement).value).toBe('1.5');
    expect((screen.getByLabelText('Outro (s)') as HTMLInputElement).value).toBe('2');
  });

  it('closes via the X button with a Close tooltip', () => {
    const onClose = vi.fn();
    render(
      <SettingsPanel
        config={DEFAULT_CONFIG}
        hasAltitude
        onChange={() => {}}
        onClose={onClose}
      />,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.getAttribute('title')).toBe('Close');
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

  it('snaps back to the committed value when a keystroke is rejected', () => {
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
    const intro = screen.getByLabelText('Intro (s)') as HTMLInputElement;

    fireEvent.change(intro, { target: { value: '-1' } });
    expect(intro.value).toBe('2'); // never keeps displaying a rejected value

    fireEvent.change(intro, { target: { value: '1.5' } });
    expect(intro.value).toBe('1.5'); // the committed value stays editable
  });

  it('shows the effective chip state when the alt chip cannot render', () => {
    renderPanel(
      { ...DEFAULT_CONFIG, hud: { heading: true, alt: true, speed: false } },
      false,
    );
    const alt = screen.getByLabelText('Altitude (ALT)') as HTMLInputElement;
    expect(alt.checked).toBe(false); // the chip would not show
    expect(alt.disabled).toBe(true);
  });

  it('disables the alt chip toggle when the telemetry has no altitude', () => {
    const { rerender } = renderPanel(DEFAULT_CONFIG, false);
    const alt = screen.getByLabelText('Altitude (ALT)') as HTMLInputElement;
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
