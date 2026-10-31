'use client';

export interface ProgressBarProps {
  /** The accessible name, e.g. "Export progress" or "Preparation progress". */
  label: string;
  /** Whole percent, 0–100. */
  percent: number;
}

// The one determinate progress pattern: an 8px pill track with an accent fill
// (design guidelines §8.6), shared by the export dialog and the preparation
// status.
export function ProgressBar({ label, percent }: ProgressBarProps) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
