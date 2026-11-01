'use client';

import { useCallback, useMemo, useState } from 'react';

import type { UiSession } from '../../src/appsession.js';
import { hasAltitude } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import { restyleSceneData } from '../../src/restyle.js';
import { formatFrameSpan, formatTime } from '../lib/frametime.js';
import { engagedLoop, hasLoop } from '../lib/loop.js';
import type { PickState } from '../lib/pickstate.js';
import { useDialogs } from '../hooks/useDialogs.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { usePlayerHotkeys } from '../hooks/usePlayerHotkeys.js';
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
  const totalText = formatTime(durationSec);
  const {
    ready,
    playing,
    setPlaying,
    speed,
    setSpeed,
    loop,
    setLoopPoint,
    clearLoop,
    scrubTo,
    stepBy,
    togglePlay,
    handleScene,
    videoRef,
    scrubRef,
    timeRef,
  } = usePlayback(video, totalText);
  const { modalOpen, settingsOpen, exportOpen, dismissible, dispatchDialog } = useDialogs();
  const [mapIsMain, setMapIsMain] = useState(false);
  const swap = useCallback(() => setMapIsMain((v) => !v), []);

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

  const dispatch = usePlayerHotkeys(
    {
      togglePlay,
      setSpeed,
      stepBy,
      scrubTo,
      setLoopPoint,
      clearLoop,
      swap,
      openRecording: onOpen,
      closeOverlay: () => dispatchDialog({ type: 'close' }),
    },
    { modalOpen, fps: video.fps, frames: video.frames },
  );

  const loopPoints = engagedLoop(loop);
  const loopReadout = hasLoop(loop)
    ? `loop ${formatFrameSpan(loop.in, loop.out, video.fps)}`
    : '';
  const maxFrame = Math.max(0, video.frames - 1);
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
          dismissible={dismissible}
          onRunEvent={dispatchDialog}
        />
      ) : null}
    </>
  );
}
