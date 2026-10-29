'use client';

import { useCallback, useReducer, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
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
  const nextId = useRef(0);

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
    return <PlayerChrome key={loaded.id} session={loaded.value} onOpen={handlePick} />;
  }
  return <LandingPanel state={pickState} onPick={handlePick} />;
}
