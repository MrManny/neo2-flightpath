// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsIcon } from '../../ui/icons/SettingsIcon.js';

afterEach(cleanup);

// The geometry assertions pin the vendored Lucide path data, so an icon bump
// cannot silently drift from upstream.
describe('SettingsIcon', () => {
  it('renders the vendored Lucide settings geometry', () => {
    const { container } = render(<SettingsIcon />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const paths = [...container.querySelectorAll('path')].map((p) =>
      p.getAttribute('d'),
    );
    expect(paths).toEqual([
      'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    ]);
    const circle = container.querySelector('circle');
    expect(
      [circle?.getAttribute('cx'), circle?.getAttribute('cy'), circle?.getAttribute('r')],
    ).toEqual(['12', '12', '3']);
  });
});
