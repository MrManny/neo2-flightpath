'use client';

import { useId } from 'react';

import { STYLE_VALUES, VIEW_VALUES } from '../../src/config.js';
import type { RenderConfig, Style, View } from '../../src/config.js';
import { CloseIcon } from '../icons/CloseIcon.js';
import { patchConfig, setHudChip } from '../lib/settings.js';
import { NumberField } from './NumberField.js';

export interface SettingsPanelProps {
  config: RenderConfig;
  /** False when the telemetry has no altitude: the alt chip cannot show. */
  hasAltitude: boolean;
  onChange: (config: RenderConfig) => void;
  onClose: () => void;
}

function SelectField(props: {
  label: string;
  value: string;
  options: readonly string[];
  onValue: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onValue(e.target.value)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

const HUD_CHIPS: Array<{ chip: 'heading' | 'alt' | 'speed'; label: string }> = [
  { chip: 'heading', label: 'Heading arrow' },
  { chip: 'alt', label: 'Altitude (ALT)' },
  { chip: 'speed', label: 'Speed (SPD)' },
];

export function SettingsPanel({
  config,
  hasAltitude,
  onChange,
  onClose,
}: SettingsPanelProps) {
  const apply = (patch: Parameters<typeof patchConfig>[1]): boolean => {
    const next = patchConfig(config, patch);
    if (!next) return false;
    onChange(next);
    return true;
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        </div>

        <SelectField
          label="Map style"
          value={config.style}
          options={STYLE_VALUES}
          onValue={(style) => apply({ style: style as Style })}
        />
        <SelectField
          label="View"
          value={config.view}
          options={VIEW_VALUES}
          onValue={(view) => apply({ view: view as View })}
        />

        <NumberField
          label="Zoom"
          value={config.zoom}
          min={0}
          hint="0 = auto-fit"
          onValue={(zoom) => apply({ zoom })}
        />
        <NumberField
          label="Zoom-out"
          value={config.zoomOut}
          min={0}
          hint="auto-fit only"
          onValue={(zoomOut) => apply({ zoomOut })}
        />
        <NumberField
          label="Intro (s)"
          value={config.introSec}
          min={0}
          step={0.5}
          onValue={(introSec) => apply({ introSec })}
        />
        <NumberField
          label="Outro (s)"
          value={config.outroSec}
          min={0}
          step={0.5}
          onValue={(outroSec) => apply({ outroSec })}
        />

        <fieldset className="settings-group">
          <legend>HUD chips</legend>
          {HUD_CHIPS.map(({ chip, label }) => {
            const altUnavailable = chip === 'alt' && !hasAltitude;
            return (
              <label key={chip} className="settings-row">
                <input
                  type="checkbox"
                  checked={config.hud[chip] && !altUnavailable}
                  disabled={altUnavailable}
                  title={
                    altUnavailable
                      ? 'Altitude unavailable in this telemetry'
                      : undefined
                  }
                  onChange={(e) =>
                    apply({ hud: setHudChip(config.hud, chip, e.target.checked) })
                  }
                />
                <span>{label}</span>
              </label>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}
