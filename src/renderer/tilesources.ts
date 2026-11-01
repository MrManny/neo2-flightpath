// The tile-source vocabulary: where tiles come from and how they look. Pure
// data shared by the tile pipeline (Node) and the shared map renderer
// (browser); cache layout lives in tilecache.ts, download logic in tiles.ts.
// Lives inside renderer/ so the browser-served module graph stays within
// that directory.

import type { Style } from '../config.js';

export interface TileSource {
  cacheKey: string;
  url: string;
  subdomains: string[];
  attribution: string;
  bg: string;
  placeholderBg: string;
  tileFilter: string | null;
  maxZoom: number;
  maxNativeZoom?: number;
}

export const TILE_SOURCES: Record<Style, TileSource> = {
  // Esri World Imagery (free for non-commercial use, attribution required).
  // Tiles are JPEG; the cache filename stays .png and browsers decode by
  // content, which is fine for Leaflet <img> tiles.
  satellite: {
    cacheKey: 'esri-imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [''],
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    bg: '#0b0e14',
    placeholderBg: '#2a2f38',
    tileFilter: 'saturate(1.06) contrast(1.03)',
    maxZoom: 19,
  },
  // OpenTopoMap: OSM topography with contour lines and shaded relief - rich
  // detail in alpine terrain. Tiles are native to z17; Leaflet auto-scales
  // them above that (maxNativeZoom), so the view zoom stays style-independent.
  topo: {
    cacheKey: 'opentopomap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    bg: '#eae5da',
    placeholderBg: '#eae5da',
    tileFilter: null,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
};
