'use client';

import { useId } from 'react';

export interface SelectFieldProps {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValue: (value: string) => void;
}

// The settings row shape around a native select: options show plain words
// while the raw vocabulary value is what applies.
export function SelectField({ label, value, options, onValue }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onValue(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
