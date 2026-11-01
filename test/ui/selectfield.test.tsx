// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectField } from '../../ui/components/SelectField.js';

afterEach(cleanup);

const OPTIONS = [
  { value: 'satellite', label: 'Satellite' },
  { value: 'topo', label: 'Topographic' },
];

function renderStyle() {
  const onValue = vi.fn();
  render(<SelectField label="Map style" value="satellite" options={OPTIONS} onValue={onValue} />);
  return { select: screen.getByLabelText<HTMLSelectElement>('Map style'), onValue };
}

describe('SelectField', () => {
  it('labels the select and shows plain words for the raw values', () => {
    const { select } = renderStyle();
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['satellite', 'Satellite'],
      ['topo', 'Topographic'],
    ]);
    expect(select.value).toBe('satellite');
  });
});

describe.each(['satellite', 'topo'])('choosing %s', (value) => {
  it('commits the raw vocabulary value', () => {
    const { select, onValue } = renderStyle();
    fireEvent.change(select, { target: { value } });
    expect(onValue).toHaveBeenCalledWith(value);
  });
});
