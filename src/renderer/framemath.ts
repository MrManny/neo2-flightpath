// Pure viewport and timeline math for the shared renderer. Kept free of DOM
// and Leaflet so the frame-exact behaviors stay unit-testable.

export function computeScale(width: number, height: number): number {
  return Math.max(0.7, Math.min(2.2, Math.min(width, height) / 1024));
}

export function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

// Intro/outro zoom-out: 0.5 = one zoom level further out, smoothstepped.
export function introOutroScale(
  i: number,
  introN: number,
  outroN: number,
  totalN: number,
): number {
  let kIn = 1;
  let kOut = 1;
  if (introN > 0 && i < introN) {
    kIn = Math.pow(2, -(1 - smoothstep(i / introN)));
  }
  if (outroN > 0 && i > totalN - 1 - outroN) {
    kOut = Math.pow(2, -(1 - smoothstep((totalN - 1 - i) / outroN)));
  }
  return Math.min(kIn, kOut);
}

export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.033928 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// The map never zooms during a render, so the scale bar picks one step once.
export function scaleBarMeters(mPerPx: number, maxPx: number): number {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let best = steps[0] as number;
  for (const step of steps) {
    if (step / mPerPx <= maxPx) best = step;
  }
  return best;
}
