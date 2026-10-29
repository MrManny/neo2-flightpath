'use client';

import type { PickState } from '../lib/pickstate.js';

export interface LandingPanelProps {
  state: PickState;
  onPick: () => void;
}

function statusText(state: PickState): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'busy':
      return 'Preparing the recording (telemetry and map tiles)…';
    case 'canceled':
      return 'No recording picked.';
    case 'error':
      return `Could not open the recording: ${state.message}`;
    case 'ready':
      return '';
  }
}

export function LandingPanel({ state, onPick }: LandingPanelProps) {
  return (
    <main className="landing">
      <h1>neo2-flightpath</h1>
      <p>
        Pick a drone recording to watch its flight path on the map in sync with
        the footage.
      </p>
      <button
        type="button"
        className="primary"
        onClick={onPick}
        disabled={state.kind === 'busy'}
      >
        {state.kind === 'busy' ? 'Preparing…' : 'Open recording…'}
      </button>
      <p className="status">{statusText(state)}</p>
      <p className="hint">
        Requires ffmpeg/ffprobe on PATH. An .SRT sidecar next to the video is
        picked up automatically.
      </p>
    </main>
  );
}
