// Per-style renderer colors. One mapping so the generated page and the app's
// map island can never drift apart.

import type { Style } from '../config.js';

export interface Theme {
  core: string;
  glow: string;
  casing: string;
  ghost: string;
  ghostOpacity: number;
  ghostCasing: string | null;
  discBg: string;
  vignette: number;
}

const THEMES: Record<Style, Theme> = {
  satellite: {
    core: '#41f0ff',
    glow: 'rgba(65,240,255,0.32)',
    casing: 'rgba(10,14,20,0.9)',
    ghost: '#ffffff',
    ghostOpacity: 0.85,
    ghostCasing: 'rgba(8,12,18,0.55)',
    discBg: 'rgba(10,14,20,0.82)',
    vignette: 0.16,
  },
  topo: {
    core: '#e63946',
    glow: 'rgba(230,57,70,0.26)',
    casing: '#ffffff',
    ghost: '#6b6252',
    ghostOpacity: 0.7,
    ghostCasing: 'rgba(255,255,255,0.8)',
    discBg: 'rgba(26,22,18,0.85)',
    vignette: 0.06,
  },
};

export function themeFor(style: Style): Theme {
  return THEMES[style];
}
