'use client';

import { useEffect, useRef } from 'react';

import { bootScene } from '../../src/renderer/boot.js';
import type { Scene, SceneData } from '../../src/renderer/scene.js';
import 'leaflet/dist/leaflet.css';

export interface MapIslandProps {
  data: SceneData;
  onScene: (scene: Scene) => void;
}

// Leaflet touches window at module load, so it can only be imported in the
// browser; the shared scene is then created after mount against this host.
// The scene lives as long as the recording: settings changes restyle it in
// place via update() instead of remounting the map. A ResizeObserver re-lays
// out the scene whenever the frame size settles or changes: the pane size may
// still be zero at creation time, and the follow-view math centers the drone
// off-screen when it falls back to the export canvas size.
export function MapIsland({ data, onScene }: MapIslandProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const dataRef = useRef(data);
  const onSceneRef = useRef(onScene);

  // The boot effect below runs once, after the lazy Leaflet import settles;
  // syncing the latest props here keeps it from building the scene or
  // reporting it through stale props without remounting the map.
  useEffect(() => {
    dataRef.current = data;
    onSceneRef.current = onScene;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const observer = new ResizeObserver(() => sceneRef.current?.relayout());
    observer.observe(host);
    void (async () => {
      const { default: L } = await import('leaflet');
      if (cancelled) return;
      const created = bootScene(host, dataRef.current, L);
      sceneRef.current = created;
      onSceneRef.current(created);
    })();
    return () => {
      cancelled = true;
      observer.disconnect();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(data);
  }, [data]);

  // Leaflet's internal panes are z-indexed up to 700; isolating the host
  // keeps them from painting over the picture-in-picture pane.
  return (
    <div
      id="scene-host"
      className="scene-host"
      style={{ isolation: 'isolate' }}
      ref={hostRef}
    />
  );
}
