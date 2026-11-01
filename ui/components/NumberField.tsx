'use client';

import { useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  /** The rule a rejected value breaks, phrased to follow "must be", e.g. "0 or more". */
  rule: string;
  step?: number;
  hint?: string;
  /** Returns whether the value committed; a rejected value stays visible with its message until blur. */
  onValue: (value: number) => boolean;
}

// The message takes the hint's place in the same row, so showing or clearing it
// never changes the layout: a button below the field keeps its position between
// mousedown (which blurs the field) and mouseup.
export function NumberField({ label, value, min, rule, step, hint, onValue }: NumberFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  // The draft is what the user typed; it is shown while the field is focused
  // so a rejected value stays visible next to its message. Blur reverts it.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        step={step ?? 1}
        value={draft ?? String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = raw === '' ? Number.NaN : Number(raw);
          // onValue commits the value upstream (a side effect), so it runs
          // only once the field's own checks have passed.
          if (!Number.isFinite(parsed) || parsed < min) {
            setInvalid(true);
            return;
          }
          setInvalid(!onValue(parsed));
        }}
        onBlur={() => {
          setDraft(null);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <span className="field-message" id={messageId}>
          {`Must be ${rule}.`}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}
