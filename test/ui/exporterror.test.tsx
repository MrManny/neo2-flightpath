// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportError } from '../../ui/components/ExportError.js';

afterEach(cleanup);

describe('ExportError', () => {
  it('describes the failure and ends with the left-untouched sentence', () => {
    render(<ExportError error="EEXIST: file already exists, mkdir '/exports/blocked-folder'" onClose={vi.fn()} />);
    expect(screen.getByText(/A file named "blocked-folder" is in the way\./)).toBeTruthy();
    expect(screen.getByText(/The destination file was left untouched\./)).toBeTruthy();
  });

  it('keeps the raw message under Technical details', () => {
    render(<ExportError error="EEXIST: file already exists, mkdir '/exports/blocked-folder'" onClose={vi.fn()} />);
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(
      screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'"),
    ).toBeTruthy();
  });

  it('offers Close', () => {
    const onClose = vi.fn();
    render(<ExportError error="the app backend went away" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
