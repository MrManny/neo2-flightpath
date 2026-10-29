// Trail growth state machine shared by the headless renderer and the app:
// forward playback appends decimated points in place (no per-frame array
// copies), any jump rebuilds the trail prefix with one setLatLngs per layer.
// The body must stay self-contained: buildPageHtml embeds it into the page
// via createTrailController.toString().

export interface TrailLayer {
  /** Leaflet's addLatLng takes one <LatLng> ([lat, lon]) argument. */
  addLatLng(latlng: [number, number]): void;
  setLatLngs(points: Array<[number, number]>): void;
}

export interface TrailController {
  /** Aligns every layer's trail with the decimated prefix up to frame i. */
  setFrame(i: number): void;
}

export function createTrailController(
  trailLat: readonly number[],
  trailLon: readonly number[],
  trailFrame: readonly number[],
  layers: readonly TrailLayer[],
): TrailController {
  // Crossing more points than this in one call (scrub or seek) rebuilds:
  // addLatLng re-projects the whole polyline, so N appends cost N*O(n).
  const APPEND_LIMIT = 8;
  let cursor = -1;

  function rebuild(k: number): void {
    const points: Array<[number, number]> = [];
    for (let j = 0; j <= k; j++) points.push([trailLat[j], trailLon[j]]);
    for (const layer of layers) layer.setLatLngs(points);
    cursor = k;
  }

  return {
    setFrame(i: number): void {
      if (trailFrame.length === 0) return;
      // Largest k with trailFrame[k] <= i (trailFrame is strictly increasing).
      let lo = 0;
      let hi = trailFrame.length - 1;
      let k = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (trailFrame[mid] <= i) {
          k = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (k > cursor) {
        if (k - cursor <= APPEND_LIMIT) {
          for (let j = cursor + 1; j <= k; j++) {
            for (const layer of layers) {
              layer.addLatLng([trailLat[j], trailLon[j]]);
            }
          }
          cursor = k;
        } else {
          rebuild(k);
        }
      } else if (k < cursor) {
        rebuild(k);
      }
    },
  };
}
