// Session vocabulary and state machine for the desktop app, free of Electron
// APIs: pick -> validate -> prepare -> hold one prepared recording.

import fs from 'node:fs';
import path from 'node:path';

import { MEDIA_URL, TILE_BASE } from './apppaths.js';
import type { RenderConfig } from './config.js';
import { errorMessage } from './errors.js';
import { buildSceneData } from './page.js';
import type { SceneData } from './renderer/scene.js';
import { prepareSession, recordingPageOpts } from './run.js';
import type { LogFn } from './run.js';

export interface PageVideo {
  /** Media URL the <video> element loads, e.g. "app://bundle/media/video". */
  src: string;
  /** Frames per second as a number; seeks snap to i / fps. */
  fps: number;
  frames: number;
  /** Source dimensions; the picture-in-picture box matches this aspect. */
  width: number;
  height: number;
}

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
}

export interface PickResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

export type PrepareUiSession = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
) => Promise<UiSession>;

// The shared pipeline preparation plus the scene data the UI drives.
export const prepareUiSession: PrepareUiSession = async (videoPath, config, log) => {
  const prep = await prepareSession(videoPath, config, log);
  return {
    scene: buildSceneData(recordingPageOpts(prep, config), TILE_BASE),
    video: {
      src: MEDIA_URL,
      fps: prep.probe.fps.value,
      frames: prep.probe.frames,
      width: prep.probe.width,
      height: prep.probe.height,
    },
  };
};

export interface AppSessionOptions {
  config: RenderConfig;
  /** Opens the native file dialog; resolves null when the user cancels. */
  pickFile: () => Promise<string | null>;
  prepare?: PrepareUiSession;
  log?: (msg: string) => void;
}

export interface AppSession {
  pick(): Promise<PickResult>;
  getSession(): UiSession | null;
  videoPath(): string | null;
}

function isReadableVideo(filePath: string): boolean {
  if (!filePath.toLowerCase().endsWith('.mp4')) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function createAppSession(options: AppSessionOptions): AppSession {
  const { config, pickFile } = options;
  const prepare = options.prepare ?? prepareUiSession;
  const log = options.log ?? ((): void => {});
  let session: UiSession | null = null;
  let videoPath: string | null = null;
  let picking = false;

  return {
    async pick(): Promise<PickResult> {
      if (picking) return { ok: false, error: 'a pick is already in progress' };
      picking = true;
      try {
        const picked = await pickFile();
        if (picked === null) return { ok: false, canceled: true };
        const resolved = path.resolve(picked);
        if (!isReadableVideo(resolved)) {
          log(`rejected: ${resolved}`);
          return { ok: false, error: `not a readable .mp4 file: ${resolved}` };
        }
        session = await prepare(resolved, config, log);
        videoPath = resolved;
        log(`loaded: ${resolved}`);
        return { ok: true };
      } catch (e) {
        log(`error: ${errorMessage(e)}`);
        return { ok: false, error: errorMessage(e) };
      } finally {
        picking = false;
      }
    },
    getSession: () => session,
    videoPath: () => videoPath,
  };
}
