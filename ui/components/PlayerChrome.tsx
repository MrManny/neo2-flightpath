'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';
import { createFrameDriver, formatTime } from '../lib/framedriver.js';
import { MapIsland } from './MapIsland.js';

export interface PlayerChromeProps {
  session: UiSession;
  onOpen: () => void;
}

// Picture-in-picture box sizing: it adopts the video's aspect so footage
// shows without bars and without cropping; the map fills whatever box holds
// it. Portrait (9:16) footage binds the box by height so it stays compact.
function pipStyle(
  pipHoldsVideo: boolean,
  width: number,
  height: number,
): React.CSSProperties {
  if (pipHoldsVideo && width > 0 && height > 0) {
    const portrait = height > width;
    return {
      aspectRatio: `${width} / ${height}`,
      width: portrait ? 'auto' : '30%',
      height: portrait ? '45%' : 'auto',
    };
  }
  return { aspectRatio: '16 / 9', width: '30%', height: 'auto' };
}

export function PlayerChrome({ session, onOpen }: PlayerChromeProps) {
  const { scene: sceneData, video } = session;
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const driverRef = useRef<ReturnType<typeof createFrameDriver> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mapIsMain, setMapIsMain] = useState(false);
  const [timeText, setTimeText] = useState(() => `0:00 / ${formatTime((video.frames - 1) / video.fps)}`);
  const [fpsText, setFpsText] = useState('');

  const handleScene = useCallback((scene: Scene) => {
    sceneRef.current = scene;
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

  useEffect(() => {
    const onResize = () => sceneRef.current?.relayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    sceneRef.current?.relayout();
  }, [mapIsMain]);

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
        <div className={`pane ${mapIsMain ? 'pane-pip' : 'pane-main'}`}>
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
          style={pipStyle(!mapIsMain, video.width, video.height)}
          title="Click to swap"
          onClick={swap}
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
      </div>
    </>
  );
}
