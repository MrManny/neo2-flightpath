'use client';

import type { ReactNode, RefObject } from 'react';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { pipStyle } from '../lib/pipstyle.js';
import { MapIsland } from './MapIsland.js';

export interface PlayerStageProps {
  video: PageVideo;
  sceneData: SceneData;
  mapIsMain: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onScene: (scene: Scene) => void;
  onPlayState: (playing: boolean) => void;
  /** The open-flow notices, centered over the stage. */
  notice: ReactNode;
}

// The two panes and their picture-in-picture arrangement: the video is the
// main pane and the map the pip one until the view is swapped.
export function PlayerStage({
  video,
  sceneData,
  mapIsMain,
  videoRef,
  onScene,
  onPlayState,
  notice,
}: PlayerStageProps) {
  return (
    <div className="stage">
      <div
        className={`pane ${mapIsMain ? 'pane-pip' : 'pane-main'}`}
        style={mapIsMain ? pipStyle(true, video.width, video.height) : undefined}
      >
        <video
          ref={videoRef}
          src={video.src}
          preload="auto"
          playsInline
          onPlay={() => onPlayState(true)}
          onPause={() => onPlayState(false)}
          onEnded={() => onPlayState(false)}
        />
      </div>
      <div
        className={`pane ${mapIsMain ? 'pane-main' : 'pane-pip'}`}
        style={mapIsMain ? undefined : pipStyle(false)}
      >
        <MapIsland data={sceneData} onScene={onScene} />
      </div>
      {notice ? <div className="player-notices">{notice}</div> : null}
    </div>
  );
}
