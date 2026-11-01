// Imperative frame driver: it owns the video element and its animation
// callbacks. The frame index is the single source of truth: every explicit
// seek lands half a frame into i's span; during playback the index is derived
// from the frame the video actually presents (never clocked separately), so
// video and map cannot drift apart. The pure quantization and loop rules live
// in frametime.ts and loop.ts.

import type { PageVideo } from '../../src/appsession.js';
import { clampFrame, frameFromMediaTime } from './frametime.js';
import type { LoopPoints, LoopState } from './loop.js';
import { engagedLoop } from './loop.js';

export interface FrameDriverOpts {
  video: HTMLVideoElement;
  meta: PageVideo;
  /** Applies the committed frame to the renderer. */
  applyFrame: (i: number) => void;
  /** Reports the committed frame index for the scrubber and time text. */
  onIndex: (i: number) => void;
}

export interface FrameDriver {
  /** Queues a scrub target; the loop applies it (coalesced) and seeks into frame i. */
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

  // Explicit seeks land half a frame into the target's span: an exact i / fps
  // can fall a few floating-point ulps under frame i's own PTS and settle the
  // previous frame (#92), while a mid-span target presents frame i.
  function seekToFrame(i: number): void {
    video.currentTime = (i + 0.5) / fps;
  }

  // The wrap seeks and commits immediately so no out-of-region frame flashes
  // on screen while the seek settles.
  function wrapTo(active: LoopPoints): void {
    seekToFrame(active.in);
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
      seekToFrame(seekTo);
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
