// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportCanceled } from '../../ui/components/ExportCanceled.js';

afterEach(cleanup);

describe('ExportCanceled', () => {
  it('says the working file was removed', () => {
    render(<ExportCanceled onClose={vi.fn()} />);
    expect(screen.getByText('Export canceled; its working file was removed.')).toBeTruthy();
  });

  it('offers Close', () => {
    const onClose = vi.fn();
    render(<ExportCanceled onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
