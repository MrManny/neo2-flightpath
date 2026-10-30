// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExportIcon } from '../../ui/icons/ExportIcon.js';
import { FolderOpenIcon } from '../../ui/icons/FolderOpenIcon.js';
import { MarkInIcon } from '../../ui/icons/MarkInIcon.js';
import { MarkOutIcon } from '../../ui/icons/MarkOutIcon.js';
import { PauseIcon } from '../../ui/icons/PauseIcon.js';
import { PlayIcon } from '../../ui/icons/PlayIcon.js';
import { SwapIcon } from '../../ui/icons/SwapIcon.js';

afterEach(cleanup);

describe.each([
  { name: 'PlayIcon', Icon: PlayIcon },
  { name: 'PauseIcon', Icon: PauseIcon },
  { name: 'FolderOpenIcon', Icon: FolderOpenIcon },
  { name: 'SwapIcon', Icon: SwapIcon },
  { name: 'ExportIcon', Icon: ExportIcon },
  { name: 'MarkInIcon', Icon: MarkInIcon },
  { name: 'MarkOutIcon', Icon: MarkOutIcon },
])('$name', ({ Icon }) => {
  it('draws in the shared line style and stays hidden from assistive technology', () => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children.length).toBeGreaterThan(0);
  });
});
