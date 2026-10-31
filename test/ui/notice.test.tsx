// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Notice } from '../../ui/components/Notice.js';
import type { NoticeTone } from '../../ui/components/Notice.js';

afterEach(cleanup);

describe.each<{ tone: NoticeTone; role: string }>([
  { tone: 'info', role: 'status' },
  { tone: 'warning', role: 'status' },
  { tone: 'danger', role: 'alert' },
])('a $tone notice', ({ tone, role }) => {
  it('announces with the role its tone calls for and carries the tone class', () => {
    const { container } = render(<Notice tone={tone}>Something happened.</Notice>);
    expect(screen.getByRole(role).textContent).toContain('Something happened.');
    expect(container.querySelector(`.notice-${tone}`)).not.toBeNull();
  });
});

describe('Notice details and dismissal', () => {
  it('folds the technical text away under a disclosure', () => {
    render(
      <Notice tone="danger" details="EEXIST: file already exists, mkdir '/exports/blocked-folder'">
        A file is in the way.
      </Notice>,
    );
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'")).toBeTruthy();
  });

  it.each([{ details: undefined }, { details: null }, { details: '' }])(
    'shows no disclosure for details %j',
    ({ details }) => {
      render(<Notice tone="info" details={details}>Done.</Notice>);
      expect(screen.queryByText('Technical details')).toBeNull();
    },
  );

  it('calls onDismiss from its Dismiss button', () => {
    const onDismiss = vi.fn();
    render(
      <Notice tone="danger" onDismiss={onDismiss}>
        Failed.
      </Notice>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no Dismiss button when nothing can dismiss it', () => {
    render(<Notice tone="info">Done.</Notice>);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
