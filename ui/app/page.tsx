'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { LandingPanel } from '../components/LandingPanel.js';
import { PlayerChrome } from '../components/PlayerChrome.js';
import { appBridge } from '../lib/backend.js';
import { pickReducer } from '../lib/pickstate.js';

interface LoadedSession {
  id: number;
  value: UiSession;
}

export default function Page() {
  const [pickState, dispatch] = useReducer(pickReducer, { kind: 'idle' });
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  // One settings object for the panel and (later) the export queue; seeded
  // from the resolved config the app backend hands over.
  const [settings, setSettings] = useState<RenderConfig>(DEFAULT_CONFIG);
  const nextId = useRef(0);

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

  const handlePick = useCallback(() => {
    dispatch({ type: 'pick' });
    void (async () => {
      try {
        const result = await appBridge().pickRecording();
        if (result.canceled) {
          dispatch({ type: 'canceled' });
          return;
        }
        if (!result.ok) {
          dispatch({ type: 'failed', message: result.error ?? 'unknown error' });
          return;
        }
        const session = await appBridge().getSession();
        if (!session) {
          dispatch({ type: 'failed', message: 'no recording loaded' });
          return;
        }
        nextId.current += 1;
        setLoaded({ id: nextId.current, value: session });
        dispatch({ type: 'picked' });
      } catch (e) {
        dispatch({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  if (loaded) {
    return (
      <PlayerChrome
        key={loaded.id}
        session={loaded.value}
        settings={settings}
        onSettingsChange={setSettings}
        onOpen={handlePick}
      />
    );
  }
  return <LandingPanel state={pickState} onPick={handlePick} />;
}
