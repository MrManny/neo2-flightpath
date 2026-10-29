// Session vocabulary shared by the app backend and the UI: what one prepared
// recording looks like on the wire.

import type { PageVideo } from './page.js';
import type { SceneData } from './renderer/scene.js';

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
}
