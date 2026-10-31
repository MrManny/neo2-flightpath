// Interactive frame driver, framework-free so the frame-exact behaviors stay
// unit-testable. The frame index is the single source of truth: every explicit
// seek snaps the video to i / fps; during playback the index is derived from
// the frame the video actually presents (never clocked separately), so video
// and map cannot drift apart.

import type { PageVideo } from '../../src/appsession.js';

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

export interface FrameDriverOpts {
  video: HTMLVideoElement;
  meta: PageVideo;
  /** Applies the committed frame to the renderer. */
  applyFrame: (i: number) => void;
  /** Reports the committed frame index for the scrubber and time text. */
  onIndex: (i: number) => void;
}

export interface LoopPoints {
  /** First frame of the loop region, inclusive. */
  in: number;
  /** Last frame of the loop region, inclusive; playback wraps past it. */
  out: number;
}

export interface LoopState {
  /** Loop start frame, or null while unset. */
  in: number | null;
  /** Loop end frame, or null while unset. */
  out: number | null;
}

// The one engagement rule for loop regions: both ends set and ordered.
// Out-of-order pairs stay dormant until the second point lands inside the
// region. Everything (band, readout, wrap) derives from this.
export function engagedLoop(state: LoopState): LoopPoints | null {
  return state.in !== null && state.out !== null && state.in < state.out
    ? { in: state.in, out: state.out }
    : null;
}

export interface FrameDriver {
  /** Queues a scrub target; the loop applies it (coalesced) and seeks i / fps. */
  scrub(i: number): void;
  /** Sets the loop region points; null clears the loop. */
  setLoop(state: LoopState | null): void;
  start(): void;
  stop(): void;
}

export function createFrameDriver(opts: FrameDriverOpts): FrameDriver {
  const { video, meta } = opts;
  const { fps, frames } = meta;
  let shownIdx = -1;
  let pendingScrub: number | null = null;
  let loop: LoopState | null = null;
  let running = false;
  let rafId = 0;
  let presentedId = 0;

  function commit(i: number): void {
    if (i === shownIdx) return;
    shownIdx = i;
    opts.applyFrame(i);
    opts.onIndex(i);
  }

  function activeLoop(): LoopPoints | null {
    return loop === null ? null : engagedLoop(loop);
  }

  // The wrap seeks and commits immediately so no out-of-region frame flashes
  // on screen while the seek settles.
  function wrapTo(active: LoopPoints): void {
    video.currentTime = active.in / fps;
    commit(active.in);
  }

  // Played-back frames are confined to the region, but explicit seek targets
  // stay verbatim: a seek presents a frame (even while paused), and only
  // frames the video actually plays past the out point wrap.
  function commitPlayed(i: number): void {
    const active = activeLoop();
    if (active !== null && i > active.out && !video.paused && !video.ended) {
      wrapTo(active);
      return;
    }
    commit(i);
  }

  // The frame the browser actually presents is the truth: its mediaTime maps
  // to the frame index via floor (round would make the map lead the footage
  // by half a frame). One callback per presented frame, chained.
  function onPresentedFrame(_now: number, meta_: { mediaTime: number }): void {
    if (!running) return;
    commitPlayed(frameFromMediaTime(meta_.mediaTime, fps, frames));
    presentedId = video.requestVideoFrameCallback(onPresentedFrame);
  }
  const usePresented = typeof video.requestVideoFrameCallback === 'function';

  function tick(_now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    const active = activeLoop();
    if (pendingScrub !== null) {
      const seekTo = pendingScrub;
      pendingScrub = null;
      video.currentTime = seekTo / fps;
      commit(seekTo);
    } else if (active !== null && video.ended) {
      // The end of the file is a loop boundary too: a region ending on the
      // last frame would otherwise stop instead of repeating. Resume is
      // best-effort; play state resyncs from the media events either way.
      wrapTo(active);
      video.play().catch(() => {});
    } else if (!usePresented && !video.paused && !video.ended) {
      // Fallback clock when requestVideoFrameCallback is unavailable; only
      // while playing, so a paused scrub target is never re-derived into a
      // neighboring frame.
      commitPlayed(frameFromMediaTime(video.currentTime, fps, frames));
    }
  }

  return {
    scrub(i: number): void {
      pendingScrub = clampFrame(i, frames);
    },
    setLoop(state: LoopState | null): void {
      loop = state;
    },
    start(): void {
      if (running) return;
      running = true;
      if (usePresented && presentedId === 0) {
        presentedId = video.requestVideoFrameCallback(onPresentedFrame);
      }
      rafId = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
      // The presented-frame chain must die with the driver: a stale chain
      // would keep committing (and wrapping) on a detached video element.
      if (usePresented && presentedId !== 0) {
        video.cancelVideoFrameCallback(presentedId);
        presentedId = 0;
      }
    },
  };
}
