// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NumberField } from '../../ui/components/NumberField.js';
import type { NumberFieldProps } from '../../ui/components/NumberField.js';

afterEach(cleanup);

function renderZoom(overrides: Partial<NumberFieldProps> = {}) {
  const onValue = overrides.onValue ?? vi.fn(() => true);
  render(
    <NumberField
      label="Zoom"
      value={0}
      min={0}
      rule="0 or more"
      hint="0 = auto-fit"
      {...overrides}
      onValue={onValue}
    />,
  );
  return { input: screen.getByLabelText('Zoom') as HTMLInputElement, onValue };
}

// A value equal to the field's current 0 would not fire a change event at all.
describe.each(['1', '2.5', '1000'])('a valid value %s', (value) => {
  it('commits, keeps the hint and shows no message', () => {
    const { input, onValue } = renderZoom();
    fireEvent.change(input, { target: { value } });
    expect(onValue).toHaveBeenCalledWith(Number(value));
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Must be 0 or more.')).toBeNull();
    expect(screen.getByText('0 = auto-fit')).toBeTruthy();
  });
});

describe.each([
  { value: '-1', description: 'a negative number' },
  { value: '', description: 'an empty field' },
])('a rejected value for $description', ({ value }) => {
  it('names the rule, marks the field invalid and commits nothing', () => {
    const { input, onValue } = renderZoom();
    fireEvent.change(input, { target: { value } });
    const message = screen.getByText('Must be 0 or more.');
    expect(onValue).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);
    expect(input.value).toBe(value);
    expect(screen.queryByText('0 = auto-fit')).toBeNull();
  });
});

describe('NumberField message lifecycle', () => {
  it('keeps the message until the value becomes valid', () => {
    const { input, onValue } = renderZoom();
    fireEvent.change(input, { target: { value: '-1' } });
    expect(screen.getByText('Must be 0 or more.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '3' } });
    expect(screen.queryByText('Must be 0 or more.')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(onValue).toHaveBeenLastCalledWith(3);
  });

  it('clears the message and reverts the draft on blur', () => {
    const { input } = renderZoom({ value: 2 });
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.blur(input);
    expect(screen.queryByText('Must be 0 or more.')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.value).toBe('2');
  });
});

describe.each([
  { label: 'Width', rule: 'at least 64 px', value: '10' },
  { label: 'Height', rule: 'at least 64 px', value: '63' },
])('$label below its minimum', ({ label, rule, value }) => {
  it('names the minimum the config enforces', () => {
    render(
      <NumberField label={label} value={768} min={64} rule={rule} hint="px" onValue={() => true} />,
    );
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    expect(screen.getByText(`Must be ${rule}.`)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('NumberField when the settings reject a value the minimum allows', () => {
  it('marks the field invalid instead of committing it', () => {
    const { input, onValue } = renderZoom({ onValue: vi.fn(() => false) });
    fireEvent.change(input, { target: { value: '5' } });
    expect(onValue).toHaveBeenCalledWith(5);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Must be 0 or more.')).toBeTruthy();
  });
});
