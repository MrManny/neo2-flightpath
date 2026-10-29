// The settings panel edits one RenderConfig through the same validation the
// CLI applies, so the panel can never hold a value the pipeline would reject.

import { validateRenderConfig } from '../../src/config.js';
import type {
  ConfigOverrides,
  HudSpec,
  PanelPreset,
  RenderConfig,
} from '../../src/config.js';

export function patchConfig(
  config: RenderConfig,
  patch: ConfigOverrides,
): RenderConfig | null {
  const next: RenderConfig = { ...config, ...patch, hud: patch.hud ?? config.hud };
  try {
    validateRenderConfig(next);
    return next;
  } catch {
    return null;
  }
}

export function applyPreset(
  config: RenderConfig,
  preset: PanelPreset,
): RenderConfig {
  return patchConfig(config, preset.overrides) ?? config;
}

export function setHudChip(
  hud: HudSpec,
  chip: keyof HudSpec,
  on: boolean,
): HudSpec {
  const next = { ...hud };
  next[chip] = on;
  return next;
}
