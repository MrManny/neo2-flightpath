// URL and path layout for the desktop app: the custom-scheme vocabulary and
// build-artifact locations have exactly one home.

import path from 'node:path';

export const APP_ORIGIN = 'app://bundle';
export const MEDIA_PATH = '/media/video';
export const MEDIA_URL = APP_ORIGIN + MEDIA_PATH;
export const TILE_BASE = APP_ORIGIN + '/tiles';

/** The Next.js static export (ui/out) next to the app shell directory. */
export function uiExportRoot(shellDir: string): string {
  return path.join(shellDir, '..', 'ui', 'out');
}
