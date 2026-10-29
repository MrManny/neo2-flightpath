'use client';

import { useId, useState } from 'react';

import { PANEL_PRESETS, STYLE_VALUES, VIEW_VALUES } from '../../src/config.js';
import type { RenderConfig, Style, View } from '../../src/config.js';
import { applyPreset, patchConfig, setHudChip } from '../lib/settings.js';

export interface SettingsPanelProps {
  config: RenderConfig;
  /** False when the telemetry has no altitude: the alt chip cannot show. */
  hasAltitude: boolean;
  onChange: (config: RenderConfig) => void;
  onClose: () => void;
}

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  step?: number;
  hint?: string;
  /** Returns whether the value committed; rejected values snap back. */
  onValue: (value: number) => boolean;
}) {
  const id = useId();
  // The display is derived: it shows the draft while the user types and the
  // committed value otherwise, so it can never desync from the settings and
  // never races any effect timing. Rejected keystrokes drop the draft and
  // snap back immediately.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        min={props.min}
        step={props.step ?? 1}
        value={draft ?? String(props.value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            setDraft(raw);
            return;
          }
          const value = Number(raw);
          const committed = Number.isFinite(value) && props.onValue(value);
          setDraft(committed ? raw : null);
        }}
        onBlur={() => setDraft(null)}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
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
          <button type="button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className="settings-presets">
          {PANEL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(applyPreset(config, preset))}
            >
              {preset.label}
            </button>
          ))}
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
