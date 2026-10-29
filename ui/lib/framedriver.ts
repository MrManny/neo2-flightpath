// Interactive frame driver, framework-free so the frame-exact behaviors stay
// unit-testable. The frame index is the single source of truth: every explicit
// seek snaps the video to i / fps; during playback the index is derived from
// the frame the video actually presents (never clocked separately), so video
// and map cannot drift apart.

import type { PageVideo } from '../../src/appsession.js';

export function frameFromMediaTime(mediaTime: number, fps: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(mediaTime * fps + 1e-6)));
}

export function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return Math.floor(total / 60) + ':' + ('0' + (total % 60)).slice(-2);
}

export interface FrameDriverOpts {
  video: HTMLVideoElement;
  meta: PageVideo;
  /** Applies the committed frame to the renderer. */
  applyFrame: (i: number) => void;
  /** Reports the committed frame index for the scrubber and time text. */
  onIndex: (i: number) => void;
  /** Reports the measured playback rate periodically while running. */
  onFps: (fps: number) => void;
}

export interface FrameDriver {
  /** Queues a scrub target; the loop applies it (coalesced) and seeks i / fps. */
  scrub(i: number): void;
  start(): void;
  stop(): void;
}

export function createFrameDriver(opts: FrameDriverOpts): FrameDriver {
  const { video, meta } = opts;
  const { fps, frames } = meta;
  let shownIdx = -1;
  let pendingScrub: number | null = null;
  let lastFpsT = 0;
  let fpsAcc = 0;
  let fpsCount = 0;
  let fpsShownAt = 0;
  let running = false;
  let rafId = 0;
  let presentedHooked = false;

  function commit(i: number): void {
    if (i === shownIdx) return;
    shownIdx = i;
    opts.applyFrame(i);
    opts.onIndex(i);
  }

  // The frame the browser actually presents is the truth: its mediaTime maps
  // to the frame index via floor (round would make the map lead the footage
  // by half a frame). One callback per presented frame, chained.
  function onPresentedFrame(_now: number, meta_: { mediaTime: number }): void {
    commit(frameFromMediaTime(meta_.mediaTime, fps, frames));
    video.requestVideoFrameCallback(onPresentedFrame);
  }
  const usePresented = typeof video.requestVideoFrameCallback === 'function';

  function tick(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (pendingScrub !== null) {
      const seekTo = pendingScrub;
      pendingScrub = null;
      video.currentTime = seekTo / fps;
      commit(seekTo);
    } else if (!usePresented && !video.paused && !video.ended) {
      // Fallback clock when requestVideoFrameCallback is unavailable; only
      // while playing, so a paused scrub target is never re-derived into a
      // neighboring frame.
      commit(frameFromMediaTime(video.currentTime, fps, frames));
    }
    if (lastFpsT > 0) {
      fpsAcc += now - lastFpsT;
      fpsCount++;
    }
    lastFpsT = now;
    if (fpsCount >= 20 && now - fpsShownAt > 500) {
      opts.onFps(1000 / (fpsAcc / fpsCount));
      fpsAcc = 0;
      fpsCount = 0;
      fpsShownAt = now;
    }
  }

  return {
    scrub(i: number): void {
      pendingScrub = Math.max(0, Math.min(frames - 1, i));
    },
    start(): void {
      if (running) return;
      running = true;
      if (usePresented && !presentedHooked) {
        presentedHooked = true;
        video.requestVideoFrameCallback(onPresentedFrame);
      }
      rafId = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
