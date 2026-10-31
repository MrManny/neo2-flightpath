import { describe, expect, it } from 'vitest';

import type { PrepareProgress } from '../../src/run.js';
import { prepareNoticeText, preparePercent } from '../../ui/lib/preparetext.js';

function progress(overrides: Partial<PrepareProgress> = {}): PrepareProgress {
  return { stage: 'probe', done: 0, total: 3, tilesDone: 0, tilesTotal: 0, ...overrides };
}

describe('prepareNoticeText', () => {
  it.each<{ overrides: Partial<PrepareProgress>; text: string }>([
    { overrides: { stage: 'probe' }, text: 'Probing the recording…' },
    { overrides: { stage: 'telemetry' }, text: 'Loading telemetry…' },
    { overrides: { stage: 'plan' }, text: 'Planning the view…' },
    { overrides: { stage: 'tiles', tilesDone: 12, tilesTotal: 48 }, text: 'Warming tiles… 12/48' },
    { overrides: { stage: 'tiles', tilesDone: 0, tilesTotal: 48 }, text: 'Warming tiles… 0/48' },
  ])('names the running stage as "$text"', ({ overrides, text }) => {
    expect(prepareNoticeText(progress(overrides))).toBe(text);
  });
});

describe('preparePercent', () => {
  it.each([
    { done: 0, total: 3, percent: 0 },
    { done: 1, total: 3, percent: 33 },
    { done: 3, total: 51, percent: 6 },
    { done: 15, total: 51, percent: 29 },
    { done: 51, total: 51, percent: 100 },
    { done: 0, total: 0, percent: 0 },
  ])('reads the steps $done/$total as $percent%', ({ done, total, percent }) => {
    expect(preparePercent(progress({ done, total }))).toBe(percent);
  });
});
