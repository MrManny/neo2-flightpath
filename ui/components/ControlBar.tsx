'use client';

import type { RefObject } from 'react';

import { formatLoopReadout, formatTimeReadout } from '../lib/frametime.js';
import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopState } from '../lib/loop.js';
import { engagedLoop, hasLoop } from '../lib/loop.js';
import { CloseIcon } from '../icons/CloseIcon.js';
import { ExportIcon } from '../icons/ExportIcon.js';
import { FolderOpenIcon } from '../icons/FolderOpenIcon.js';
import { MarkInIcon } from '../icons/MarkInIcon.js';
import { MarkOutIcon } from '../icons/MarkOutIcon.js';
import { PauseIcon } from '../icons/PauseIcon.js';
import { PlayIcon } from '../icons/PlayIcon.js';
import { SettingsIcon } from '../icons/SettingsIcon.js';
import { SwapIcon } from '../icons/SwapIcon.js';

export interface ControlBarProps {
  /** The player's action map: buttons and hotkeys drive the same actions. */
  dispatch: (action: HotkeyAction) => void;
  /** The Open flow is preparing: the button is busy and says so. */
  opening: boolean;
  ready: boolean;
  playing: boolean;
  speed: 1 | 2 | 3 | 4;
  loop: LoopState;
  /** Raw timeline values; the bar formats its own readouts from them. */
  fps: number;
  durationSec: number;
  maxFrame: number;
  scrubTo: (i: number) => void;
  scrubRef: RefObject<HTMLInputElement | null>;
  timeRef: RefObject<HTMLSpanElement | null>;
  onExport: () => void;
  onSettings: () => void;
}

export function ControlBar({
  dispatch,
  opening,
  ready,
  playing,
  speed,
  loop,
  fps,
  durationSec,
  maxFrame,
  scrubTo,
  scrubRef,
  timeRef,
  onExport,
  onSettings,
}: ControlBarProps) {
  const bandPct = (i: number): number => (maxFrame > 0 ? (i / maxFrame) * 100 : 0);
  const loopPoints = engagedLoop(loop);
  const loopReadout = formatLoopReadout(loop, fps);
  const clearable = hasLoop(loop);
  return (
    <div className="controls">
      <div className="controls-left">
        <button type="button" onClick={() => dispatch({ type: 'openRecording' })} disabled={opening}>
          <FolderOpenIcon />
          Open…
        </button>
      </div>
      <div className="controls-center">
        <button type="button" onClick={() => dispatch({ type: 'togglePlay' })} disabled={!ready}>
          {ready && playing ? <PauseIcon /> : <PlayIcon />}
          {ready ? (playing ? 'Pause' : 'Play') : 'Warming tiles…'}
        </button>
        <button
          type="button"
          aria-label="Set loop in"
          title="Set loop in (I)"
          onClick={() => dispatch({ type: 'setLoopIn' })}
        >
          <MarkInIcon />
          In
        </button>
        <button
          type="button"
          aria-label="Set loop out"
          title="Set loop out (O)"
          onClick={() => dispatch({ type: 'setLoopOut' })}
        >
          <MarkOutIcon />
          Out
        </button>
        <button
          type="button"
          aria-label="Clear loop"
          title={clearable ? 'Clear loop (Esc)' : 'No loop to clear.'}
          disabled={!clearable}
          onClick={() => dispatch({ type: 'clearLoop' })}
        >
          <CloseIcon />
          Clear
        </button>
        <div className="scrubber">
          {loopPoints ? (
            <div
              className="loop-band"
              style={{
                left: `${bandPct(loopPoints.in)}%`,
                width: `${bandPct(loopPoints.out) - bandPct(loopPoints.in)}%`,
              }}
            />
          ) : null}
          <input
            ref={scrubRef}
            type="range"
            aria-label="Playback position"
            min={0}
            max={maxFrame}
            step={1}
            defaultValue={0}
            onChange={(e) => scrubTo(Number(e.target.value))}
          />
        </div>
        <span className="readout" ref={timeRef}>
          {formatTimeReadout(0, fps, durationSec)}
        </span>
        {loopReadout ? <span className="readout loop-readout">{loopReadout}</span> : null}
        <div className="speed-group" role="group" aria-label="Playback speed">
          {([1, 2, 3, 4] as const).map((rate) => (
            <button
              key={rate}
              type="button"
              className="speed"
              aria-pressed={speed === rate}
              title={`Playback speed ${rate}× (${rate})`}
              onClick={() => dispatch({ type: 'speed', rate })}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
      <div className="controls-right">
        <button type="button" onClick={() => dispatch({ type: 'swapView' })}>
          <SwapIcon />
          Swap view
        </button>
        <button type="button" onClick={onExport}>
          <ExportIcon />
          Export…
        </button>
        <button
          type="button"
          title="Settings"
          aria-label="Settings"
          onClick={onSettings}
        >
          <SettingsIcon />
          Settings
        </button>
      </div>
    </div>
  );
}
