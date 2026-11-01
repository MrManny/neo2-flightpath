// The scene bootstrap both shells share: create the scene against its host
// and re-measure once the layout settles. Shell wiring (the React lifecycle,
// the headless window bridges) stays with its shell.
import type { LeafletApi } from './leaflet.js';
import type { Scene, SceneData } from './scene.js';
import { createScene } from './scene.js';

export function bootScene(host: HTMLElement, data: SceneData, L: LeafletApi): Scene {
  const scene = createScene(host, data, { L });
  // The pane size may only settle after creation; re-measure post-layout.
  requestAnimationFrame(() => scene.relayout());
  return scene;
}
