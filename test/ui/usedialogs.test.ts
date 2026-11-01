// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDialogs } from '../../ui/hooks/useDialogs.js';
import type { DialogEvent } from '../../ui/lib/dialogstate.js';

afterEach(cleanup);

function mountDialogs() {
  const { result } = renderHook(() => useDialogs());
  const send = (event: DialogEvent): void => {
    act(() => {
      result.current.dispatchDialog(event);
    });
  };
  return { result, send };
}

describe('useDialogs', () => {
  it('starts closed', () => {
    const { result } = mountDialogs();
    expect(result.current).toEqual({
      modalOpen: false,
      settingsOpen: false,
      exportOpen: false,
      dismissible: true,
      dispatchDialog: result.current.dispatchDialog,
    });
  });

  it('opens the settings dialog', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openSettings' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.exportOpen).toBe(false);
    expect(result.current.dismissible).toBe(true);
  });

  it('opens the export dialog', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
  });

  it('pins the dialog and refuses dismissal while a job runs', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(false);
  });

  it('ignores close while a job runs', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    send({ type: 'close' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(false);
  });

  it('returns to the form and allows dismissal when the job finishes', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openExport' });
    send({ type: 'exportStarted' });
    send({ type: 'exportFinished' });
    expect(result.current.exportOpen).toBe(true);
    expect(result.current.dismissible).toBe(true);
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
  });

  it('closes an open dialog', () => {
    const { result, send } = mountDialogs();
    send({ type: 'openSettings' });
    send({ type: 'close' });
    expect(result.current.modalOpen).toBe(false);
    expect(result.current.settingsOpen).toBe(false);
  });
});
