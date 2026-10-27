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

const EARTH_RADIUS_M = 6371008.8; // mean Earth radius
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function haversineM(a: LatLon, b: LatLon): number {
  const deltaLatRad = (b.lat - a.lat) * DEG_TO_RAD;
  const deltaLonRad = (b.lon - a.lon) * DEG_TO_RAD;
  const latARad = a.lat * DEG_TO_RAD;
  const latBRad = b.lat * DEG_TO_RAD;
  const haversine =
    Math.sin(deltaLatRad / 2) ** 2 +
    Math.cos(latARad) * Math.cos(latBRad) * Math.sin(deltaLonRad / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

// Initial bearing a -> b, degrees clockwise from north, range [0, 360).
export function bearingDeg(a: LatLon, b: LatLon): number {
  const latARad = a.lat * DEG_TO_RAD;
  const latBRad = b.lat * DEG_TO_RAD;
  const deltaLonRad = (b.lon - a.lon) * DEG_TO_RAD;
  const y = Math.sin(deltaLonRad) * Math.cos(latBRad);
  const x =
    Math.cos(latARad) * Math.sin(latBRad) -
    Math.sin(latARad) * Math.cos(latBRad) * Math.cos(deltaLonRad);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

// Circular mean of bearings in degrees.
export function circularMeanDeg(degList: number[]): number {
  let sumCos = 0;
  let sumSin = 0;
  for (const deg of degList) {
    sumCos += Math.cos(deg * DEG_TO_RAD);
    sumSin += Math.sin(deg * DEG_TO_RAD);
  }
  if (sumCos === 0 && sumSin === 0) return degList[0] ?? 0;
  return (Math.atan2(sumSin, sumCos) * RAD_TO_DEG + 360) % 360;
}

// Web Mercator (EPSG:3857) global pixel coordinates at a given zoom,
// 256 px tiles, origin at the north-west corner (Leaflet convention).
export function project(lon: number, lat: number, zoom: number): Pixel {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin(
    Math.max(-85.05112878, Math.min(85.05112878, lat)) * DEG_TO_RAD,
  );
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// Inverse of project(): global pixel -> {lat, lon}.
export function unproject(x: number, y: number, zoom: number): LatLon {
  const scale = 256 * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const mercatorN = Math.PI - 2 * Math.PI * (y / scale);
  const lat = RAD_TO_DEG * Math.atan(Math.sinh(mercatorN));
  return { lat, lon };
}
