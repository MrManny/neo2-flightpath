// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { ExportOutcome } from '../../src/exportjob.js';
import type { LoopState } from '../../ui/lib/framedriver.js';
import { ExportModal } from '../../ui/components/ExportModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { neo2flightpath?: unknown }).neo2flightpath;
});

const SESSION = {
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
  stats: { durationSec: 10 },
} as unknown as UiSession;

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG, width: 768, height: 768 };

const SUMMARY = {
  video: '/v.mp4',
  out: '/exports/a.mp4',
  status: 'ok' as const,
  elapsedSec: 4,
  frames: 120,
  fps: '30000/1001',
  width: 1280,
  height: 720,
};

type Phase = 'form' | 'running' | 'done' | 'error' | 'canceled';

const FOOTERS: Record<Phase, string[]> = {
  form: ['Cancel', 'Start export'],
  running: ['Cancel export'],
  done: ['Reveal in folder', 'Open video', 'Close'],
  error: ['Close'],
  canceled: ['Close'],
};

function installBridge(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: { done?: (outcome: ExportOutcome) => void } = {};
  const bridge = {
    pickExportOutput: vi.fn(async () => ({ ok: true, path: '/exports/a.mp4' })),
    startExport: vi.fn(async () => ({ ok: true })),
    cancelExport: vi.fn(async () => ({ ok: true })),
    revealExportOutput: vi.fn(async () => ({ ok: true })),
    openExportOutput: vi.fn(async () => ({ ok: true })),
    onExportProgress: vi.fn(() => () => {}),
    onExportDone: vi.fn((cb: (outcome: ExportOutcome) => void) => {
      listeners.done = cb;
      return () => {};
    }),
    ...overrides,
  };
  (window as { neo2flightpath?: unknown }).neo2flightpath = bridge;
  return {
    bridge,
    emitDone: (outcome: ExportOutcome) => {
      act(() => {
        listeners.done?.(outcome);
      });
    },
  };
}

function renderModal(loop: LoopState) {
  return render(
    <ExportModal
      session={SESSION}
      settings={SETTINGS}
      loop={loop}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
}

async function reachPhase(phase: Phase, emitDone: (outcome: ExportOutcome) => void) {
  renderModal({ in: null, out: null });
  if (phase === 'form') return;
  fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
  await screen.findByRole('button', { name: 'Cancel export' });
  if (phase === 'running') return;
  if (phase === 'done') emitDone({ status: 'ok', summary: SUMMARY });
  if (phase === 'error') {
    emitDone({ status: 'error', error: "EEXIST: file already exists, mkdir '/exports/blocked-folder'" });
  }
  if (phase === 'canceled') emitDone({ status: 'canceled' });
}

function dialogFooter(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Export' }).querySelector('.dialog-actions') as HTMLElement;
}

function headerClose(): HTMLButtonElement {
  const header = screen.getByRole('dialog', { name: 'Export' }).querySelector('.settings-header') as HTMLElement;
  return within(header).getByRole('button', { name: 'Close' }) as HTMLButtonElement;
}

describe('ExportModal what-to-export choice', () => {
  it('does not offer a segment choice when no loop is engaged', () => {
    installBridge();
    renderModal({ in: null, out: null });
    expect(screen.queryByRole('group', { name: 'What' })).toBeNull();
    expect(screen.queryByText(/set loop points first/)).toBeNull();
  });

  it('offers the segment choice once a loop is engaged', () => {
    installBridge();
    renderModal({ in: 10, out: 29 });
    expect(screen.getByRole('radio', { name: /In–Out segment/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Full recording/ })).toBeTruthy();
  });
});

describe('ExportModal save-first flow', () => {
  it('opens the save dialog on Start export and starts nothing when it is cancelled', async () => {
    const { bridge } = installBridge({
      pickExportOutput: vi.fn(async () => ({ ok: false, canceled: true })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.pickExportOutput).toHaveBeenCalledTimes(1));
    expect(bridge.startExport).not.toHaveBeenCalled();
  });

  it('starts the export with the chosen path once the dialog returns one', async () => {
    const { bridge } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0]).toMatchObject({
      outPath: '/exports/a.mp4',
      range: null,
    });
  });

  it('exports the full recording when a stale segment is no longer engaged', async () => {
    const { bridge } = installBridge();
    const { rerender } = renderModal({ in: 10, out: 29 });
    fireEvent.click(screen.getByRole('radio', { name: /In–Out segment/ }));
    rerender(
      <ExportModal
        session={SESSION}
        settings={SETTINGS}
        loop={{ in: null, out: null }}
        onClose={() => {}}
        onBusyChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].range).toBeNull();
  });
});

describe.each<Phase>(['form', 'running', 'done', 'error', 'canceled'])(
  'ExportModal footer in the %s phase',
  (phase) => {
    it('offers exactly the actions of that phase', async () => {
      const { emitDone } = installBridge();
      await reachPhase(phase, emitDone);
      expect([...dialogFooter().querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(
        FOOTERS[phase],
      );
    });
  },
);

describe.each<Phase>(['form', 'done', 'error', 'canceled'])(
  'ExportModal header Close in the %s phase',
  (phase) => {
    it('stays enabled', async () => {
      const { emitDone } = installBridge();
      await reachPhase(phase, emitDone);
      expect(headerClose().disabled).toBe(false);
    });
  },
);

describe('ExportModal while an export runs', () => {
  it('disables the header Close and says why', async () => {
    const { emitDone } = installBridge();
    await reachPhase('running', emitDone);
    expect(headerClose().disabled).toBe(true);
    expect(headerClose().getAttribute('title')).toBe('Export is running. Cancel it to close.');
  });
});

describe('ExportModal outcomes', () => {
  it('reports a finished export with its frame rate in decimal fps', async () => {
    const { emitDone } = installBridge();
    await reachPhase('done', emitDone);
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
  });

  it('rounds the elapsed seconds to whole ones', async () => {
    const { emitDone } = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await screen.findByRole('button', { name: 'Cancel export' });
    emitDone({ status: 'ok', summary: { ...SUMMARY, elapsedSec: 4.25 } });
    expect(screen.getByText('120 frames @ 29.97 fps · 4 s · 1280×720')).toBeTruthy();
  });

  it('turns a raw Node error into a sentence and keeps the original as details', async () => {
    const { emitDone } = installBridge();
    await reachPhase('error', emitDone);
    expect(screen.getByText(/A file named "blocked-folder" is in the way\./)).toBeTruthy();
    expect(screen.getByText(/The destination file was left untouched\./)).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'")).toBeTruthy();
  });

  it('says a canceled export removed its working file', async () => {
    const { emitDone } = installBridge();
    await reachPhase('canceled', emitDone);
    expect(screen.getByText('Export canceled; its working file was removed.')).toBeTruthy();
  });
});

describe('ExportModal rainy paths', () => {
  it('shows a start failure in the form and keeps the form usable', async () => {
    installBridge({
      startExport: vi.fn(async () => ({ ok: false, error: 'an export is already running' })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(
      await screen.findByText('An export is already running. Wait for it to finish or cancel it.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start export' })).toBeTruthy();
  });

  it('marks a width below the minimum with a message that names the rule', () => {
    installBridge();
    renderModal({ in: null, out: null });
    const width = screen.getByLabelText('Width', { exact: true }) as HTMLInputElement;
    fireEvent.change(width, { target: { value: '10' } });
    expect(screen.getByText('Must be at least 64 px.')).toBeTruthy();
    expect(width.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a failed Reveal in folder in the done phase', async () => {
    const { emitDone } = installBridge({
      revealExportOutput: vi.fn(async () => ({
        ok: false,
        error: "EACCES: permission denied, open '/exports/a.mp4'",
      })),
    });
    await reachPhase('done', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    expect(
      await screen.findByText('Access to "a.mp4" was denied. Choose a location you can write to.'),
    ).toBeTruthy();
  });

  it('re-enables Cancel export and says why when the cancel is refused', async () => {
    const { emitDone } = installBridge({
      cancelExport: vi.fn(async () => ({ ok: false, error: 'export could not be canceled' })),
    });
    await reachPhase('running', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(await screen.findByText('The export could not be canceled. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel export' }).disabled).toBe(false);
  });

  it('shows the reason when the cancel request itself fails', async () => {
    const { emitDone } = installBridge({
      cancelExport: vi.fn(async () => {
        throw new Error('the app backend went away');
      }),
    });
    await reachPhase('running', emitDone);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(await screen.findByText('the app backend went away')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel export' }).disabled).toBe(false);
  });
});
