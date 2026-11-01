// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotice } from '../../ui/components/ErrorNotice.js';

afterEach(cleanup);

describe('ErrorNotice', () => {
  it('turns a known message into its sentence and keeps the original as details', () => {
    render(<ErrorNotice message="EEXIST: file already exists, mkdir '/exports/blocked-folder'" />);
    expect(
      screen.getByText('A file named "blocked-folder" is in the way. Choose another folder or file name.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'")).toBeTruthy();
  });

  it('passes an unknown message through with no technical text', () => {
    render(<ErrorNotice message="the app backend went away" />);
    expect(screen.getByText('the app backend went away')).toBeTruthy();
    expect(screen.queryByText('Technical details')).toBeNull();
  });

  it('prefixes the lead sentence like the Open flow does', () => {
    render(<ErrorNotice message="no recording loaded" lead="Could not open the recording:" />);
    expect(
      screen.getByText('Could not open the recording: No recording is loaded. Open a recording first.'),
    ).toBeTruthy();
  });

  it('appends the tail sentence like the export outcome does', () => {
    render(<ErrorNotice message="boom" tail="The destination file was left untouched." />);
    expect(screen.getByText('boom The destination file was left untouched.')).toBeTruthy();
  });

  it('announces as an alert', () => {
    render(<ErrorNotice message="boom" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('calls onDismiss from its Dismiss button', () => {
    const onDismiss = vi.fn();
    render(<ErrorNotice message="boom" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no Dismiss button when nothing can dismiss it', () => {
    render(<ErrorNotice message="boom" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
