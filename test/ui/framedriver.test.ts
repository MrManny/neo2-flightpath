import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageVideo } from '../../src/appsession.js';
import { createFrameDriver } from '../../ui/lib/framedriver.js';

const META: PageVideo = { src: '/video', fps: 30, frames: 300, width: 1920, height: 1080 };

interface FakeVideo {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  play: ReturnType<typeof vi.fn>;
  requestVideoFrameCallback?: (cb: FrameCallback) => number;
  cancelVideoFrameCallback?: (id: number) => void;
}

type FrameCallback = (now: number, meta: { mediaTime: number }) => void;

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

function fakeVideo(): FakeVideo {
  const video: FakeVideo = {
    currentTime: 0,
    paused: true,
    ended: false,
    play: vi.fn(() => {
      video.paused = false;
      video.ended = false;
      return Promise.resolve();
    }),
  };
  return video;
}

// A fake that drives the requestVideoFrameCallback path, the one Electron
// actually runs: tests present frames explicitly instead of relying on time.
function fakeVideoRvfc(): {
  video: FakeVideo;
  present: (mediaTime: number) => void;
  pendingFrames: () => number;
} {
  let nextId = 1;
  const callbacks = new Map<number, FrameCallback>();
  const video: FakeVideo = {
    ...fakeVideo(),
    requestVideoFrameCallback: (cb: FrameCallback): number => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    cancelVideoFrameCallback: (id: number): void => {
      callbacks.delete(id);
    },
  };
  return {
    video,
    present: (mediaTime: number): void => {
      const first = callbacks.entries().next();
      if (first.done) return;
      const [id, cb] = first.value;
      callbacks.delete(id);
      cb(0, { mediaTime });
    },
    pendingFrames: (): number => callbacks.size,
  };
}

function build(
  video: FakeVideo,
  meta: PageVideo = META,
): {
  applyFrame: ReturnType<typeof vi.fn>;
  onIndex: ReturnType<typeof vi.fn>;
  driver: ReturnType<typeof createFrameDriver>;
} {
  const applyFrame = vi.fn();
  const onIndex = vi.fn();
  const driver = createFrameDriver({
    video: video as unknown as HTMLVideoElement,
    meta,
    applyFrame,
    onIndex,
  });
  return { applyFrame, onIndex, driver };
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
    expect(video.currentTime).toBeCloseTo(20.5 / 30);
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
    expect(video.currentTime).toBeCloseTo(0.5 / 30);
    driver.scrub(10000);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(299.5 / 30);
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

describe('createFrameDriver loop wrap', () => {
  it('wraps played frames past the out point back to the loop start', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    video.currentTime = 21 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(10.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(10);
    expect(applyFrame).not.toHaveBeenCalledWith(21);
  });

  it('plays the region through its out point before wrapping', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    video.currentTime = 20 / 30;
    flushRaf();
    expect(applyFrame).toHaveBeenCalledWith(20);
    expect(video.currentTime).toBeCloseTo(20 / 30);
  });

  it('wraps played frames on the presented-frame path without flashing the next frame', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    present(20.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(20);
    present(21 / 30);
    expect(video.currentTime).toBeCloseTo(10.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(10);
    expect(applyFrame).not.toHaveBeenCalledWith(21);
  });

  it('honors paused seek frames outside the region verbatim', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    driver.scrub(25);
    flushRaf();
    // Chromium presents the seeked frame even while paused; the loop must
    // not yank an explicit target back into the region.
    present(25 / 30);
    expect(video.currentTime).toBeCloseTo(25.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
    expect(applyFrame).not.toHaveBeenCalledWith(10);
  });

  it('honors explicit scrub targets outside the region verbatim', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    driver.scrub(25);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
    flushRaf();
    expect(applyFrame).toHaveBeenCalledTimes(1);
  });

  it('ignores an inverted region until it is ordered', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 20, out: 10 });
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
  });

  it('ignores a degenerate single-frame region', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.setLoop({ in: 15, out: 15 });
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
  });

  it('restores plain playback when the loop is cleared', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.setLoop(null);
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
  });

  it('wraps from the end of the file and resumes playback', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.setLoop({ in: 5, out: 299 });
    driver.start();
    video.currentTime = 299 / 30;
    video.ended = true;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(5.5 / 30);
    expect(video.play).toHaveBeenCalled();
    expect(video.ended).toBe(false);
  });

  it('does not wrap when paused at the end without a loop', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.start();
    video.ended = true;
    flushRaf();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });
});

describe('createFrameDriver presented-frame chain', () => {
  it('tears the chain down on stop()', () => {
    const { video, present, pendingFrames } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.start();
    present(1 / 30);
    expect(applyFrame).toHaveBeenCalledWith(1);
    driver.stop();
    expect(pendingFrames()).toBe(0);
    present(2 / 30);
    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
  });

  it('re-hooks the chain on restart', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.start();
    driver.stop();
    driver.start();
    present(5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(5);
  });

  it('ignores a presented frame that was already in flight when stop() ran', () => {
    const callbacks: FrameCallback[] = [];
    const video: FakeVideo = {
      ...fakeVideo(),
      requestVideoFrameCallback: (cb: FrameCallback): number => {
        callbacks.push(cb);
        return callbacks.length;
      },
      cancelVideoFrameCallback: (): void => {},
    };
    const { applyFrame, driver } = build(video);
    driver.start();
    const inFlight = callbacks[0];
    driver.stop();
    inFlight(0, { mediaTime: 3 / 30 });
    expect(applyFrame).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });
});

describe('createFrameDriver frame-exact seeks (#92)', () => {
  // The repro media: 330 frames at 30000/1001 fps, where frame PTS values
  // repeat in binary and µs quantization lands samples just under a frame's
  // exact start.
  const NTSC: PageVideo = { src: '/video', fps: 30000 / 1001, frames: 330, width: 1920, height: 1080 };
  const NTSC_FPS = 30000 / 1001;

  it('seeks strictly inside the target frame span', () => {
    const video = fakeVideo();
    const { driver } = build(video, NTSC);
    driver.start();
    driver.scrub(321);
    flushRaf();
    expect(video.currentTime).toBeGreaterThan(321 / NTSC_FPS);
    expect(video.currentTime).toBeLessThan(322 / NTSC_FPS);
  });

  it('keeps the last frame reachable', () => {
    const video = fakeVideo();
    const { driver } = build(video, NTSC);
    driver.start();
    driver.scrub(329);
    flushRaf();
    expect(video.currentTime).toBeGreaterThan(329 / NTSC_FPS);
    expect(video.currentTime).toBeLessThan(330 / NTSC_FPS);
  });

  it('keeps the committed index on the frame the video presents', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, onIndex, driver } = build(video, NTSC);
    driver.start();
    driver.scrub(320);
    flushRaf();
    // Frame 320's PTS quantized to the microsecond, as it arrives from
    // requestVideoFrameCallback.
    present(10.677333);
    expect(applyFrame).toHaveBeenLastCalledWith(320);
    expect(onIndex).toHaveBeenLastCalledWith(320);
  });
});
