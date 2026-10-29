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
export function MapIsland({ data, onScene }: MapIslandProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    void (async () => {
      const { default: L } = await import('leaflet');
      if (cancelled) return;
      onSceneRef.current(createScene(host, data, { L }));
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  return <div id="scene-host" className="scene-host" ref={hostRef} />;
}
