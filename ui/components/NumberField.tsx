'use client';

import { useId, useState } from 'react';

export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  step?: number;
  hint?: string;
  /** Returns whether the value committed; rejected values snap back. */
  onValue: (value: number) => boolean;
}) {
  const id = useId();
  // The display is derived: it shows the draft while the user types and the
  // committed value otherwise, so it can never desync from the settings and
  // never races any effect timing. Rejected keystrokes drop the draft and
  // snap back immediately.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        min={props.min}
        step={props.step ?? 1}
        value={draft ?? String(props.value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            setDraft(raw);
            return;
          }
          const value = Number(raw);
          const committed = Number.isFinite(value) && props.onValue(value);
          setDraft(committed ? raw : null);
        }}
        onBlur={() => setDraft(null)}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}
