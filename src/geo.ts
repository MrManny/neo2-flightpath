// geo.ts - geodesy + Web Mercator helpers.
// All coordinates are WGS84 decimal degrees; distances in meters.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface Pixel {
  x: number;
  y: number;
}

const R = 6371008.8; // mean Earth radius (m)
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const la1 = a.lat * D2R;
  const la2 = b.lat * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial bearing a -> b, degrees clockwise from north, range [0, 360).
export function bearingDeg(a: LatLon, b: LatLon): number {
  const la1 = a.lat * D2R;
  const la2 = b.lat * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

// Circular mean of bearings in degrees.
export function circularMeanDeg(degList: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const d of degList) {
    sx += Math.cos(d * D2R);
    sy += Math.sin(d * D2R);
  }
  if (sx === 0 && sy === 0) return degList[0] ?? 0;
  return (Math.atan2(sy, sx) * R2D + 360) % 360;
}

// Web Mercator (EPSG:3857) global pixel coordinates at a given zoom,
// 256 px tiles, origin at the north-west corner (Leaflet convention).
export function project(lon: number, lat: number, zoom: number): Pixel {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin(
    Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R,
  );
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Inverse of project(): global pixel -> {lat, lon}.
export function unproject(x: number, y: number, zoom: number): LatLon {
  const scale = 256 * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / scale);
  const lat = R2D * Math.atan(Math.sinh(n));
  return { lat, lon };
}
