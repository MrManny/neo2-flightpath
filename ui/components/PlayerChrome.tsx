'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import { restyleSceneData } from '../../src/restyle.js';
import { createFrameDriver, formatTime } from '../lib/framedriver.js';
import { pipStyle } from '../lib/pipstyle.js';
import { MapIsland } from './MapIsland.js';
import { SettingsPanel } from './SettingsPanel.js';

export interface PlayerChromeProps {
  session: UiSession;
  settings: RenderConfig;
  onSettingsChange: (config: RenderConfig) => void;
  onOpen: () => void;
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94a7.9 7.9 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.9 7.9 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.2.38.28.6.22l2.39-.96c.5.39 1.05.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54a7.3 7.3 0 0 0 1.63-.94l2.39.96c.22.06.48-.02.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}

export function PlayerChrome({
  session,
  settings,
  onSettingsChange,
  onOpen,
}: PlayerChromeProps) {
  const { scene: preparedScene, video, tileBase, bbox } = session;
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const latestIndexRef = useRef(0);
  const driverRef = useRef<ReturnType<typeof createFrameDriver> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mapIsMain, setMapIsMain] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timeText, setTimeText] = useState(() => `0:00 / ${formatTime((video.frames - 1) / video.fps)}`);
  const [fpsText, setFpsText] = useState('');

  // One settings -> scene mapping for the preview and the later export: the
  // same pure planners the pipeline runs.
  const sceneData = useMemo(
    () =>
      restyleSceneData(preparedScene, settings, {
        fps: video.fps,
        frames: video.frames,
        tileBase,
        bbox,
      }),
    [preparedScene, settings, video.fps, video.frames, tileBase, bbox],
  );

  const handleScene = useCallback((scene: Scene) => {
    sceneRef.current = scene;
    // The driver may have committed frames before the scene existed; the
    // scene must show the current one, not its initial frame.
    void scene.setFrame(latestIndexRef.current);
    scene.ready.then(() => setReady(true));
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const driver = createFrameDriver({
      video: videoEl,
      meta: video,
      applyFrame: (i) => {
        void sceneRef.current?.setFrame(i);
      },
      onIndex: (i) => {
        latestIndexRef.current = i;
        if (scrubRef.current) scrubRef.current.value = String(i);
        setTimeText(
          `${formatTime(i / video.fps)} / ${formatTime((video.frames - 1) / video.fps)}`,
        );
      },
      onFps: (fps) => setFpsText(`${fps.toFixed(0)} fps`),
    });
    driverRef.current = driver;
    driver.start();
    return () => {
      driver.stop();
      driverRef.current = null;
    };
  }, [video]);

  const togglePlay = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) void videoEl.play();
    else videoEl.pause();
  };

  const swap = () => setMapIsMain((v) => !v);

  return (
    <>
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
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </div>
        <div
          className={`pane ${mapIsMain ? 'pane-main' : 'pane-pip'}`}
          style={mapIsMain ? undefined : pipStyle(false)}
        >
          <MapIsland data={sceneData} onScene={handleScene} />
        </div>
      </div>
      <div className="controls">
        <button type="button" onClick={togglePlay} disabled={!ready}>
          {ready ? (playing ? 'Pause' : 'Play') : 'Warming tiles…'}
        </button>
        <button type="button" onClick={onOpen}>
          Open recording…
        </button>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={Math.max(0, video.frames - 1)}
          step={1}
          defaultValue={0}
          onChange={(e) => driverRef.current?.scrub(Number(e.target.value))}
        />
        <span className="readout">{timeText}</span>
        <span className="readout">{fpsText}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={swap}>
          Swap view
        </button>
        <button
          type="button"
          className="cog"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <CogIcon />
        </button>
      </div>
      {settingsOpen ? (
        <SettingsPanel
          config={settings}
          hasAltitude={hasAltitude(preparedScene.alt)}
          onChange={onSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
