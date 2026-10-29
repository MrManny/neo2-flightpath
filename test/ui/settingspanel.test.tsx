// @vitest-environment jsdom
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

  it('applies a preset bundle in one click', () => {
    const onChange = vi.fn();
    renderPanel(DEFAULT_CONFIG, true, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Topo + full HUD' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        style: 'topo',
        hud: { heading: true, alt: true, speed: true },
      }),
    );
  });

  it('keeps manual tweaks working after a preset', () => {
    const onChange = vi.fn();
    renderPanel(DEFAULT_CONFIG, true, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Quick render' }));
    fireEvent.change(screen.getByLabelText('Zoom'), {
      target: { value: '12' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 12, style: 'satellite' }),
    );
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
