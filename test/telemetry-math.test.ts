import { describe, expect, it } from 'vitest';

import { gpsFix } from '../src/geo.js';
import { buildTelemetry } from '../src/telemetry-math.js';
import type { TelSample } from '../src/telemetry-math.js';

// Raw coordinates in, a sample out; the fixture applies the parsers'
// fix/no-lock decision (src/geo.ts's gpsFix), so placeholder and out-of-range
// coordinates land as fix = null exactly like parser output.
function sample(
  tSec: number,
  lat: number | null,
  lon: number | null,
  extras: Partial<TelSample> = {},
): TelSample {
  return { tSec, fix: gpsFix(lat, lon), relAlt: null, absAlt: null, yawDeg: null, ...extras };
}

function build(samples: TelSample[], frames: number, fpsValue: number) {
  return buildTelemetry(
    { samples, source: 'srt', method: 'srt-cues', noLock: 0 },
    { frames, fpsValue },
  );
}

describe('buildTelemetry', () => {
  it('builds per-frame values from the samples', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388, { relAlt: 3.3 }),
        sample(1 / 30, 46.61308, 14.262388, { relAlt: 3.4 }),
        sample(2 / 30, 46.61309, 14.262388, { relAlt: 3.5 }),
      ],
      3,
      30,
    );

    expect(tel.headingMode).toBe('cog'); // no yaw in these samples
    expect(tel.sampleCount).toBe(3);
    expect(tel.fixCount).toBe(3);
    expect(tel.frames).toHaveLength(3);

    // First frame sits on the first fix.
    expect(tel.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].fix?.lon).toBeCloseTo(14.262388, 6);
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);

    // Speed is the smoothed centered difference, rounded to one decimal
    // (~1.11 m per 0.00001 degree of latitude, two steps over 2/30 s).
    expect(tel.frames[1].speed).toBeCloseTo(33.4, 0);

    // The northbound track yields a northbound course.
    const heading = tel.frames[1].headingDeg;
    expect(Math.min(heading, 360 - heading)).toBeLessThan(5);

    // bbox covers both end fixes; track distance is the path length.
    expect(tel.bbox.minLat).toBeCloseTo(46.61307, 6);
    expect(tel.bbox.maxLat).toBeCloseTo(46.61309, 6);
    expect(tel.trackDistanceM).toBeGreaterThan(0);
    expect(tel.trackDistanceM).toBeLessThan(5);
  });

  it('counts fixes exactly when a sample has no coordinates at all', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388),
        sample(0.04, null, null),
        sample(0.08, 0, 0),
        sample(0.12, 46.613072, 14.26239),
      ],
      1,
      1,
    );
    expect(tel.sampleCount).toBe(4);
    expect(tel.fixCount).toBe(2);
  });

  it('carries the source provenance through', () => {
    const tel = buildTelemetry(
      {
        samples: [sample(0, 46.61307, 14.262388), sample(0.04, 46.613072, 14.26239)],
        source: 'cammeta',
        method: 'dvtm-packets',
        noLock: 7,
      },
      { frames: 1, fpsValue: 1 },
    );
    expect(tel.source).toBe('cammeta');
    expect(tel.method).toBe('dvtm-packets');
    expect(tel.noLock).toBe(7);
  });

  it('interpolates positions between fixes', () => {
    const tel = build(
      [sample(0, 46.6, 14.2), sample(1, 46.7, 14.3)],
      2,
      2,
    );
    // Frame 1 sits at t=0.5, halfway between the fixes.
    expect(tel.frames[1].fix?.lat).toBeCloseTo(46.65, 6);
    expect(tel.frames[1].fix?.lon).toBeCloseTo(14.25, 6);
  });

  it('holds the earlier fix across long gaps instead of interpolating', () => {
    // 10 s apart: beyond the interpolation gap, the frame holds the earlier
    // fix rather than gliding across half a kilometer.
    const tel = build(
      [sample(0, 46.6, 14.2), sample(10, 46.7, 14.3)],
      6,
      1,
    );
    expect(tel.frames[5].fix?.lat).toBeCloseTo(46.6, 6);
  });

  it('holds the first and last fix on frames past the telemetry ends', () => {
    // Frames before the first fix hold the first fix; frames after the last
    // fix hold the last fix - a trailing frame must never jump back to the
    // flight's start (regression).
    const tel = build(
      [
        sample(0, null, null, { relAlt: 3.3 }),
        sample(0.04, 46.61307, 14.262388),
        sample(0.08, 46.613072, 14.26239),
        sample(0.12, null, null, { relAlt: 3.6 }),
      ],
      4,
      25,
    );

    expect(tel.fixCount).toBe(2);
    // Leading frame holds the first fix.
    expect(tel.frames[0].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[0].fix?.lon).toBeCloseTo(14.262388, 6);
    // Trailing frames hold the last fix.
    expect(tel.frames[3].fix?.lat).toBeCloseTo(46.613072, 6);
    expect(tel.frames[3].fix?.lon).toBeCloseTo(14.26239, 6);
    // Interior frames keep their nearest fix across the gap.
    expect(tel.frames[1].fix?.lat).toBeCloseTo(46.61307, 6);
    expect(tel.frames[2].fix?.lat).toBeCloseTo(46.613072, 6);
  });

  it('prefers relative altitude and falls back to absolute', () => {
    const tel = build(
      [
        sample(0, 46.61307, 14.262388, { relAlt: 3.3, absAlt: 313.2 }),
        sample(0.04, 46.613071, 14.262389, { relAlt: null, absAlt: 313.3 }),
      ],
      2,
      25,
    );
    expect(tel.frames[0].alt).toBeCloseTo(3.3, 6);
    expect(tel.frames[1].alt).toBeCloseTo(313.3, 6);
  });

  describe('heading', () => {
    it('back-fills leading headings from the first known heading', () => {
      // Hover, then fly north, then turn east. The leading hover has no
      // course over ground, so its heading must be back-filled from the
      // FIRST known heading (north) - not the flight's final one (east).
      const samples: TelSample[] = [];
      for (let i = 0; i <= 70; i++) {
        let lat = 46.613;
        let lon = 14.262;
        if (i >= 21 && i <= 40) lat += (i - 20) * 0.00001;
        if (i >= 41) {
          lat += 20 * 0.00001;
          lon += (i - 40) * 0.00001;
        }
        samples.push(sample(i * 0.04, lat, lon, { relAlt: 3.3 }));
      }

      const tel = build(samples, 71, 25);

      expect(tel.headingMode).toBe('cog');
      // Frame 0 is still hovering: its heading must match the northbound leg.
      const first = tel.frames[0].headingDeg;
      expect(Math.min(first, 360 - first)).toBeLessThan(30);
      // The final frames face east - the turn is real and was detected.
      const last = tel.frames[70].headingDeg;
      expect(Math.abs(last - 90)).toBeLessThan(30);
    });

    it('tracks course over ground on slow flights instead of holding one value', () => {
      // A slow eastbound crawl (~1 m/s): a fixed 0.7 s course baseline never
      // clears the jitter floor here, so earlier versions held one stale
      // heading for the whole flight. The baseline must widen instead.
      const samples: TelSample[] = [];
      for (let i = 0; i <= 124; i++) {
        samples.push(
          sample(i * 0.04, 46.613, 14.262 + i * 0.00000052, { relAlt: 3.3 }),
        );
      }

      const tel = build(samples, 125, 25);

      expect(tel.headingMode).toBe('cog');
      for (const frame of [30, 60, 90, 120]) {
        expect(Math.abs(tel.frames[frame].headingDeg - 90)).toBeLessThan(25);
      }
    });

    it('prefers body yaw over course over ground and normalizes it', () => {
      const tel = build(
        [
          sample(0, 46.61307, 14.262388, { yawDeg: 400 }),
          sample(0.04, 46.613071, 14.262389, { yawDeg: 400 }),
        ],
        2,
        25,
      );
      expect(tel.headingMode).toBe('yaw');
      expect(tel.frames[0].headingDeg).toBeCloseTo(40, 0);
      expect(tel.frames[1].headingDeg).toBeCloseTo(40, 0);
    });
  });

  describe.for([
    { name: 'no samples at all', samples: [] as TelSample[] },
    { name: 'a single fix', samples: [sample(0, 46.61307, 14.262388)] },
    {
      name: 'only placeholders',
      samples: [sample(0, 0, 0), sample(0.04, 0, 0)],
    },
    {
      name: 'one fix among placeholders',
      samples: [sample(0, 0, 0), sample(0.04, 46.61307, 14.262388)],
    },
  ])('rejects $name', ({ samples }) => {
    it('throws before planning any frames', () => {
      expect(() => build(samples, 1, 1)).toThrow(
        'telemetry has fewer than 2 GPS fixes',
      );
    });
  });
});
