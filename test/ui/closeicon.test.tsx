// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CloseIcon } from '../../ui/icons/CloseIcon.js';

afterEach(cleanup);

// The geometry assertions pin the vendored Lucide path data, so an icon bump
// cannot silently drift from upstream.
describe('CloseIcon', () => {
  it('renders the vendored Lucide x geometry', () => {
    const { container } = render(<CloseIcon />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const paths = [...container.querySelectorAll('path')].map((p) =>
      p.getAttribute('d'),
    );
    expect(paths).toEqual(['M18 6 6 18', 'm6 6 12 12']);
  });
});
