// Leaflet ships no types of its own; the shared renderer's minimal facade is
// the contract this app relies on, so the module is typed as exactly that.
declare module 'leaflet' {
  import type { LeafletApi } from '../../src/renderer/leaflet.js';

  const L: LeafletApi;
  export default L;
}
