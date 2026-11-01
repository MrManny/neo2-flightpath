'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import { restyleSceneData } from '../../src/restyle.js';
import {
  clampFrame,
  formatFrameSpan,
  formatTime,
  framesForSeconds,
  timeAt,
} from '../lib/frametime.js';
import { createFrameDriver } from '../lib/framedriver.js';
import type { LoopState } from '../lib/loop.js';
import { engagedLoop, hasLoop } from '../lib/loop.js';
import { canDismiss, dialogReducer } from '../lib/dialogstate.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import { mapKey } from '../lib/hotkeys.js';
import type { PickState } from '../lib/pickstate.js';
import { ControlBar } from './ControlBar.js';
import { ExportModal } from './ExportModal.js';
import { OpenNotice } from './OpenNotice.js';
import { PlayerStage } from './PlayerStage.js';
import { SettingsPanel } from './SettingsPanel.js';

export interface PlayerChromeProps {
  session: UiSession;
  settings: RenderConfig;
  onSettingsChange: (config: RenderConfig) => void;
  onOpen: () => void;
  /** The Open flow: only preparing and failures show over the player. */
  openState?: PickState;
  onDismissOpenState?: () => void;
}

const NO_LOOP: LoopState = { in: null, out: null };
const IDLE_OPEN: PickState = { kind: 'idle' };

export function PlayerChrome({
  session,
  settings,
  onSettingsChange,
  onOpen,
  openState = IDLE_OPEN,
  onDismissOpenState,
}: PlayerChromeProps) {
  const { scene: preparedScene, video, tileBase, bbox, durationSec } = session;
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  // The head frame: committed or queued, so rapid steps never stack onto a
  // stale index before the driver's next tick.
  const latestIndexRef = useRef(0);
  const driverRef = useRef<ReturnType<typeof createFrameDriver> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mapIsMain, setMapIsMain] = useState(false);
  // One machine decides which dialog is open and whether anything may close
  // it: Escape, the backdrop and the header close share one rule.
  const [dialog, dispatchDialog] = useReducer(dialogReducer, 'closed');
  const modalOpen = dialog !== 'closed';
  const settingsOpen = dialog === 'settings';
  const exportOpen = dialog === 'export-form' || dialog === 'export-running';
  const [speed, setSpeed] = useState<1 | 2 | 3 | 4>(1);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);

  const totalText = formatTime(durationSec);

  // One settings -> scene mapping for the preview and the export: the same
  // pure planners the pipeline runs.
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

  const loopPoints = engagedLoop(loop);

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
        // Imperative like the scrubber: the time text changes every presented
        // frame and must not re-render the component tree at playback rate.
        if (timeRef.current) {
          timeRef.current.textContent = `${formatTime(timeAt(i, video.fps))} / ${totalText}`;
        }
      },
    });
    driverRef.current = driver;
    driver.start();
    return () => {
      driver.stop();
      driverRef.current = null;
    };
  }, [video, totalText]);

  // The loop state lives here; the driver owns the wrap mechanics.
  useEffect(() => {
    driverRef.current?.setLoop(loop);
  }, [video, loop]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) videoEl.playbackRate = speed;
  }, [speed, video]);

  const scrubTo = useCallback(
    (i: number) => {
      const clamped = clampFrame(i, video.frames);
      latestIndexRef.current = clamped;
      driverRef.current?.scrub(clamped);
    },
    [video.frames],
  );

  const togglePlay = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !ready) return;
    if (videoEl.paused) {
      // play() on ended media restarts from the file start; a loop must
      // resume at its own start.
      const active = engagedLoop(loop);
      if (videoEl.ended && active) scrubTo(active.in);
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }, [ready, loop, scrubTo]);

  const stepBy = useCallback(
    (deltaFrames: number) => {
      const videoEl = videoRef.current;
      // Stepping is for close inspection: it parks playback first.
      if (videoEl && !videoEl.paused) videoEl.pause();
      scrubTo(latestIndexRef.current + deltaFrames);
    },
    [scrubTo],
  );

  const setLoopPoint = useCallback((which: 'in' | 'out') => {
    setLoop((prev) => ({ ...prev, [which]: latestIndexRef.current }));
  }, []);

  const clearLoop = useCallback(() => setLoop(NO_LOOP), []);

  const swap = useCallback(() => setMapIsMain((v) => !v), []);

  const dispatch = useCallback(
    (action: HotkeyAction) => {
      switch (action.type) {
        case 'togglePlay':
          togglePlay();
          return;
        case 'speed':
          setSpeed(action.rate);
          return;
        case 'step':
          stepBy(action.frames);
          return;
        case 'jump':
          stepBy(framesForSeconds(video.fps, action.seconds));
          return;
        case 'seekStart':
          scrubTo(0);
          return;
        case 'seekEnd':
          scrubTo(video.frames - 1);
          return;
        case 'setLoopIn':
          setLoopPoint('in');
          return;
        case 'setLoopOut':
          setLoopPoint('out');
          return;
        case 'clearLoop':
          clearLoop();
          return;
        case 'swapView':
          swap();
          return;
        case 'openRecording':
          onOpen();
          return;
        case 'closeOverlay':
          dispatchDialog({ type: 'close' });
          return;
      }
    },
    [clearLoop, dispatchDialog, onOpen, scrubTo, setLoopPoint, stepBy, swap, togglePlay, video.fps, video.frames],
  );

  // Hotkeys must act on the latest committed state: when the handler lived
  // inside the subscribing effect, a key landing between a commit and its
  // passive effects ran a stale closure and silently no-oped (#62).
  const hotkeyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    hotkeyHandlerRef.current = (e: KeyboardEvent): void => {
      const action = mapKey(e, { modalOpen });
      if (action === null) return;
      // No page scroll on Space, no double toggle on a focused button.
      e.preventDefault();
      e.stopPropagation();
      dispatch(action);
    };
  });

  // Capture phase so claimed keys win over the map's keyboard pan/zoom; keys
  // this player does not claim still reach whatever holds focus. Subscribed
  // once: the handler ref keeps it current, so no key can arrive between a
  // commit and a re-subscribe.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => hotkeyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const maxFrame = Math.max(0, video.frames - 1);
  const loopReadout = hasLoop(loop)
    ? `loop ${formatFrameSpan(loop.in, loop.out, video.fps)}`
    : '';
  const opening = openState.kind === 'preparing';
  const openNotice =
    openState.kind === 'preparing' || openState.kind === 'error' ? (
      <OpenNotice state={openState} onDismiss={onDismissOpenState} />
    ) : null;

  return (
    <>
      <PlayerStage
        video={video}
        sceneData={sceneData}
        mapIsMain={mapIsMain}
        videoRef={videoRef}
        onScene={handleScene}
        onPlayState={setPlaying}
        notice={openNotice}
      />
      <ControlBar
        onOpen={onOpen}
        opening={opening}
        ready={ready}
        playing={playing}
        togglePlay={togglePlay}
        dispatch={dispatch}
        scrubTo={scrubTo}
        loop={loop}
        loopPoints={loopPoints}
        scrubRef={scrubRef}
        timeRef={timeRef}
        totalText={totalText}
        loopReadout={loopReadout}
        speed={speed}
        swap={swap}
        onExport={() => dispatchDialog({ type: 'openExport' })}
        onSettings={() => dispatchDialog({ type: 'openSettings' })}
        maxFrame={maxFrame}
      />
      {settingsOpen ? (
        <SettingsPanel
          config={settings}
          hasAltitude={hasAltitude(preparedScene.alt)}
          onChange={onSettingsChange}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
      ) : null}
      {exportOpen ? (
        <ExportModal
          session={session}
          settings={settings}
          loop={loop}
          onClose={() => dispatchDialog({ type: 'close' })}
          dismissible={canDismiss(dialog)}
          onRunEvent={dispatchDialog}
        />
      ) : null}
    </>
  );
}
