// Frame/time quantization and the shared time text formats. Pure so every
// formatted readout, loop label and segment string stays unit-testable
// without a DOM.

import type { LoopPoints, LoopState } from './loop.js';
import { hasLoop } from './loop.js';

// requestVideoFrameCallback reports mediaTime quantized to the microsecond,
// so a frame whose PTS falls between those ticks arrives up to ~1e-6 s before
// its exact start (10.977633 for frame 329 at 30000/1001) and the product
// lands just under its integer. The slack spans more than any such
// quantization error in frame units while staying far below the half frame
// that separates a mid-frame clock sample from the next frame's start.
const QUANTIZATION_SLACK_SEC = 1.25e-6;

export function frameFromMediaTime(mediaTime: number, fps: number, frames: number): number {
  return clampFrame(Math.floor((mediaTime + QUANTIZATION_SLACK_SEC) * fps), frames);
}

/** The one clamp rule for frame indices: 0..frames-1. */
export function clampFrame(i: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, i));
}

// Jumps stay frame-quantized: one second is round(fps) frames even for
// fractional rates like 29.97 fps.
export function framesForSeconds(fps: number, seconds: number): number {
  return Math.round(fps * seconds);
}

export function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return Math.floor(total / 60) + ':' + ('0' + (total % 60)).slice(-2);
}

export function timeAt(frame: number, fps: number): number {
  return frame / fps;
}

/** The time readout: the presented position over the recording's duration. */
export function formatTimeReadout(frame: number, fps: number, durationSec: number): string {
  return `${formatTime(timeAt(frame, fps))} / ${formatTime(durationSec)}`;
}

export function formatFrameSpan(
  start: number | null,
  end: number | null,
  fps: number,
): string {
  const at = (f: number | null): string =>
    f === null ? '?' : formatTime(timeAt(f, fps));
  return `${at(start)}–${at(end)}`;
}

export function formatFrameRange(points: LoopPoints, fps: number): string {
  return `${formatFrameSpan(points.in, points.out, fps)} · ${points.out - points.in + 1} frames`;
}

/** The loop readout; empty until any point is set. */
export function formatLoopReadout(loop: LoopState, fps: number): string {
  return hasLoop(loop) ? `loop ${formatFrameSpan(loop.in, loop.out, fps)}` : '';
}
