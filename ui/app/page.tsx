'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { LandingPanel } from '../components/LandingPanel.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { appBridge } from '../lib/backend.js';
import { pickRecordingFlow } from '../lib/pickflow.js';
import { pickReducer } from '../lib/pickstate.js';

interface LoadedSession {
  id: number;
  value: UiSession;
}

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  // One settings object for the panel and the export modal; seeded from the
  // resolved config the app backend hands over.
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const nextId = useRef(0);
  // Guards re-entry for the whole Open flow, preparation included.
  const picking = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await appBridge().getSettings();
        if (!cancelled) setSettings(resolved);
      } catch {
        // Outside the app shell there is no backend: keep the defaults.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The backend reports preparation only after the picker returned a valid file,
  // so the busy status never covers the native dialog; its progress events then
  // drive the loading bar while preparation runs.
  useEffect(() => {
    let offPreparing: (() => void) | null = null;
    let offProgress: (() => void) | null = null;
    try {
      offPreparing = appBridge().onPreparing(() => dispatch({ type: 'preparing' }));
      offProgress = appBridge().onPrepareProgress((progress) =>
        dispatch({ type: 'progress', progress }),
      );
    } catch {
      // Outside the app shell there is no backend to report progress.
    }
    return () => {
      offPreparing?.();
      offProgress?.();
    };
  }, []);

  const handlePick = useCallback(() => {
    if (picking.current) return;
    picking.current = true;
    dispatch({ type: 'pick' });
    void (async () => {
      const event = await pickRecordingFlow(
        {
          pickRecording: () => appBridge().pickRecording(),
          getSession: () => appBridge().getSession(),
        },
        (session) => {
          nextId.current += 1;
          setLoaded({ id: nextId.current, value: session });
        },
      );
      dispatch(event);
      picking.current = false;
    })();
  }, []);

  const dismissOpen = useCallback(() => dispatch({ type: 'dismiss' }), []);

  if (loaded) {
    return (
      <PlayerChrome
        key={loaded.id}
        session={loaded.value}
        settings={settings}
        onSettingsChange={setSettings}
        onOpen={handlePick}
        openState={pickState}
        onDismissOpenState={dismissOpen}
      />
    );
  }
  return <LandingPanel state={pickState} onPick={handlePick} onDismiss={dismissOpen} />;
}
