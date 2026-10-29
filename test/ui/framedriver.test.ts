import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageVideo } from '../../src/appsession.js';
import { createFrameDriver, formatTime, frameFromMediaTime } from '../../ui/lib/framedriver.js';

const META: PageVideo = { src: '/video', fps: 30, frames: 300, width: 1920, height: 1080 };

describe('frameFromMediaTime', () => {
  it.for([
    { name: 'exact frame', mediaTime: 0.5, fps: 30, frames: 300, want: 15 },
    { name: 'half frame floors', mediaTime: 0.05, fps: 30, frames: 300, want: 1 },
    { name: 'just below a frame floors', mediaTime: 0.0332, fps: 30, frames: 300, want: 0 },
    { name: 'clamps below zero', mediaTime: -5, fps: 30, frames: 300, want: 0 },
    { name: 'clamps past the end', mediaTime: 100, fps: 30, frames: 300, want: 299 },
    { name: 'single frame stays zero', mediaTime: 3, fps: 30, frames: 1, want: 0 },
  ])('$name', ({ mediaTime, fps, frames, want }) => {
    expect(frameFromMediaTime(mediaTime, fps, frames)).toBe(want);
  });
});

describe('formatTime', () => {
  it.for([
    { sec: 0, want: '0:00' },
    { sec: 65, want: '1:05' },
    { sec: 125.4, want: '2:05' },
    { sec: -5, want: '0:00' },
  ])('formats $sec as $want', ({ sec, want }) => {
    expect(formatTime(sec)).toBe(want);
  });
});

interface FakeVideo {
  currentTime: number;
  paused: boolean;
  ended: boolean;
}

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

function fakeVideo(): FakeVideo {
  return { currentTime: 0, paused: true, ended: false };
}

function build(video: FakeVideo): {
  applyFrame: ReturnType<typeof vi.fn>;
  onIndex: ReturnType<typeof vi.fn>;
  onFps: ReturnType<typeof vi.fn>;
  driver: ReturnType<typeof createFrameDriver>;
} {
  const applyFrame = vi.fn();
  const onIndex = vi.fn();
  const onFps = vi.fn();
  const driver = createFrameDriver({
    video: video as unknown as HTMLVideoElement,
    meta: META,
    applyFrame,
    onIndex,
    onFps,
  });
  return { applyFrame, onIndex, onFps, driver };
}

beforeEach(() => {
  rafQueue.length = 0;
  rafNow = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFrameDriver', () => {
  it('coalesces scrub input into one seek per tick', () => {
    const video = fakeVideo();
    const { applyFrame, onIndex, driver } = build(video);
    driver.start();
    driver.scrub(10);
    driver.scrub(20);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(20 / 30);
    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(20);
    expect(onIndex).toHaveBeenCalledWith(20);
  });

  it('clamps scrub targets to the frame range', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.start();
    driver.scrub(-5);
    flushRaf();
    expect(video.currentTime).toBe(0);
    driver.scrub(10000);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(299 / 30);
  });

  it('derives frames from the fallback clock only while playing', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    video.currentTime = 1;
    flushRaf();
    expect(applyFrame).not.toHaveBeenCalled();
    video.paused = false;
    flushRaf();
    expect(applyFrame).toHaveBeenCalledWith(30);
  });

  it('never re-derives the same frame twice', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    video.paused = false;
    video.currentTime = 1;
    flushRaf();
    flushRaf();
    expect(applyFrame).toHaveBeenCalledTimes(1);
  });

  it('reports fps after sustained sampling', () => {
    const video = fakeVideo();
    const { onFps, driver } = build(video);
    driver.start();
    for (let i = 0; i < 25; i++) flushRaf();
    expect(onFps).toHaveBeenCalled();
  });

  it('stops applying frames after stop()', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    driver.stop();
    video.paused = false;
    video.currentTime = 1;
    flushRaf();
    expect(applyFrame).not.toHaveBeenCalled();
  });
});
