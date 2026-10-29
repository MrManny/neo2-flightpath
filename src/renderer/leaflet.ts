// The minimal Leaflet surface the shared renderer touches. Consumers pass the
// real namespace in (the generated page takes window.L, the app its bundled
// module import), so this code stays free of bundler and global assumptions
// and tests can drive it with a fake.

export type LatLngTuple = [number, number];

export interface LatLng {
  lat: number;
  lng: number;
}

export type LatLngExpr = LatLngTuple | LatLng;

export interface Point {
  x: number;
  y: number;
}

export interface MapOptions {
  zoomControl: boolean;
  attributionControl: boolean;
  dragging: boolean;
  scrollWheelZoom: boolean;
  doubleClickZoom: boolean;
  boxZoom: boolean;
  keyboard: boolean;
  touchZoom: boolean;
  fadeAnimation: boolean;
  zoomAnimation: boolean;
  markerZoomAnimation: boolean;
  preferCanvas: boolean;
  zoomSnap: number;
}

export interface MapHandle {
  setView(center: LatLngExpr, zoom: number): void;
  getCenter(): LatLng;
  project(latlng: LatLngExpr, zoom: number): Point;
  invalidateSize(): void;
}

export interface LayerHandle {
  addTo(map: MapHandle): void;
  remove(): void;
}

export interface TileLayerOptions {
  maxZoom: number;
  maxNativeZoom?: number;
}

export interface TileLayerHandle extends LayerHandle {
  on(event: 'load' | 'tileerror', handler: () => void): void;
  setUrl(url: string): void;
}

export interface PolylineOptions {
  color: string;
  weight: number;
  opacity: number;
  dashArray?: string;
  lineCap?: string;
  lineJoin?: string;
  smoothFactor: number;
}

export interface PolylineHandle extends LayerHandle {
  addLatLng(latlng: LatLngTuple): void;
  setLatLngs(points: LatLngTuple[]): void;
}

export interface CircleMarkerOptions {
  radius: number;
  color: string;
  weight: number;
  fillColor: string;
  fillOpacity: number;
}

export interface MarkerOptions {
  icon: unknown;
  interactive: boolean;
  keyboard: boolean;
}

export interface DivIconOptions {
  className: string;
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
}

export interface MarkerHandle extends LayerHandle {
  setLatLng(latlng: LatLngExpr): void;
}

export interface BoundsHandle {
  getCenter(): LatLng;
  getNorthWest(): LatLng;
  getSouthEast(): LatLng;
}

export interface LeafletApi {
  map(element: HTMLElement, options: MapOptions): MapHandle;
  tileLayer(url: string, options: TileLayerOptions): TileLayerHandle;
  latLngBounds(points: LatLngTuple[]): BoundsHandle;
  polyline(points: LatLngTuple[], options: PolylineOptions): PolylineHandle;
  circleMarker(latlng: LatLngExpr, options: CircleMarkerOptions): LayerHandle;
  marker(latlng: LatLngExpr, options: MarkerOptions): MarkerHandle;
  divIcon(options: DivIconOptions): unknown;
}
