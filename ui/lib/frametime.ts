// Frame/time quantization and the shared time text formats. Pure so every
// formatted readout, loop label and segment string stays unit-testable
// without a DOM.

import type { LoopPoints } from './loop.js';

export function frameFromMediaTime(mediaTime: number, fps: number, frames: number): number {
  return clampFrame(Math.floor(mediaTime * fps + 1e-6), frames);
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
