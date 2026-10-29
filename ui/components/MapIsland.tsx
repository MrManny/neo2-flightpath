'use client';

import { useEffect, useRef } from 'react';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import { createScene } from '../../src/renderer/scene.js';

export interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
}

// Leaflet touches window at module load, so it can only be imported in the
// browser; the shared scene is then created after mount against this host.
// A ResizeObserver re-lays out the scene whenever the frame size settles or
// changes: the pane size may still be zero at creation time, and the
// follow-view math centers the drone off-screen when it falls back to the
// export canvas size.
export function MapIsland({ data, onScene }: MapIslandProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let scene: Scene | null = null;
    const observer = new ResizeObserver(() => scene?.relayout());
    observer.observe(host);
    void (async () => {
      const { default: L } = await import('leaflet');
      if (cancelled) return;
      scene = createScene(host, data, { L });
      onSceneRef.current(scene);
    })();
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [data]);

  return <div id="scene-host" className="scene-host" ref={hostRef} />;
}
