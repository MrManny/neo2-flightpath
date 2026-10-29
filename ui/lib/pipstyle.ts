import type { CSSProperties } from 'react';

// Picture-in-picture box sizing: it adopts the video's aspect so footage
// shows without bars and without cropping; the map fills whatever box holds
// it. Portrait (9:16) footage binds the box by height so it stays compact.
export function pipStyle(
  pipHoldsVideo: boolean,
  width: number,
  height: number,
): CSSProperties {
  if (pipHoldsVideo && width > 0 && height > 0) {
    const portrait = height > width;
    return {
      aspectRatio: `${width} / ${height}`,
      width: portrait ? 'auto' : '30%',
      height: portrait ? '45%' : 'auto',
    };
  }
  return { aspectRatio: '16 / 9', width: '30%', height: 'auto' };
}
