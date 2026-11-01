'use client';

import type { RefObject } from 'react';

import type { HotkeyAction } from '../lib/hotkeys.js';
import type { LoopPoints, LoopState } from '../lib/loop.js';
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
  onOpen: () => void;
  /** The Open flow is preparing: the button is busy and says so. */
  opening: boolean;
  ready: boolean;
  playing: boolean;
  togglePlay: () => void;
  /** The player's action map: buttons and hotkeys drive the same actions. */
  dispatch: (action: HotkeyAction) => void;
  scrubTo: (i: number) => void;
  loop: LoopState;
  loopPoints: LoopPoints | null;
  scrubRef: RefObject<HTMLInputElement | null>;
  timeRef: RefObject<HTMLSpanElement | null>;
  totalText: string;
  loopReadout: string;
  speed: 1 | 2 | 3 | 4;
  swap: () => void;
  onExport: () => void;
  onSettings: () => void;
  maxFrame: number;
}

export function ControlBar({
  onOpen,
  opening,
  ready,
  playing,
  togglePlay,
  dispatch,
  scrubTo,
  loop,
  loopPoints,
  scrubRef,
  timeRef,
  totalText,
  loopReadout,
  speed,
  swap,
  onExport,
  onSettings,
  maxFrame,
}: ControlBarProps) {
  const bandPct = (i: number): number => (maxFrame > 0 ? (i / maxFrame) * 100 : 0);
  return (
    <div className="controls">
      <div className="controls-left">
        <button type="button" onClick={onOpen} disabled={opening}>
          <FolderOpenIcon />
          Open…
        </button>
      </div>
      <div className="controls-center">
        <button type="button" onClick={togglePlay} disabled={!ready}>
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
          title={loop.in === null && loop.out === null ? 'No loop to clear.' : 'Clear loop (Esc)'}
          disabled={loop.in === null && loop.out === null}
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
          0:00 / {totalText}
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
        <button type="button" onClick={swap}>
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
