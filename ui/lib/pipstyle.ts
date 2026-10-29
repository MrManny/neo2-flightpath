import type { CSSProperties } from 'react';

// Picture-in-picture box sizing: it adopts the video's aspect so footage
// shows without bars and without cropping; the map fills whatever box holds
// it. Portrait (9:16) footage binds the box by height so it stays compact.
// The z-index lifts the box above the main pane in either role; the map host
// isolates Leaflet's own z-indexes so they cannot paint over the box.
export function pipStyle(
  pipHoldsVideo: boolean,
  width = 0,
  height = 0,
): CSSProperties {
  if (pipHoldsVideo && width > 0 && height > 0) {
    const portrait = height > width;
    return {
      aspectRatio: `${width} / ${height}`,
      width: portrait ? 'auto' : '30%',
      height: portrait ? '45%' : 'auto',
      zIndex: 2,
    };
  }
  return { aspectRatio: '16 / 9', width: '30%', height: 'auto', zIndex: 2 };
}
