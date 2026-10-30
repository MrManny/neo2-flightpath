// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { LoopState } from '../../ui/lib/framedriver.js';
import { ExportModal } from '../../ui/components/ExportModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { neo2flightpath?: unknown }).neo2flightpath;
});

const SESSION = {
  video: { src: 'app://bundle/media/video', fps: 30, frames: 300, width: 1280, height: 720 },
} as unknown as UiSession;

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG, width: 768, height: 768 };

function installBridge(overrides: Partial<Record<string, unknown>> = {}) {
  const bridge = {
    pickExportOutput: vi.fn(async () => ({ ok: true, path: '/exports/a.mp4' })),
    startExport: vi.fn(async () => ({ ok: true })),
    cancelExport: vi.fn(async () => ({ ok: true })),
    revealExportOutput: vi.fn(async () => ({ ok: true })),
    openExportOutput: vi.fn(async () => ({ ok: true })),
    onExportProgress: vi.fn(() => () => {}),
    onExportDone: vi.fn(() => () => {}),
    ...overrides,
  };
  (window as { neo2flightpath?: unknown }).neo2flightpath = bridge;
  return bridge;
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
  it('opens the save dialog on Export and starts nothing when it is cancelled', async () => {
    const bridge = installBridge({
      pickExportOutput: vi.fn(async () => ({ ok: false, canceled: true })),
    });
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(bridge.pickExportOutput).toHaveBeenCalledTimes(1));
    expect(bridge.startExport).not.toHaveBeenCalled();
  });

  it('starts the export with the chosen path once the dialog returns one', async () => {
    const bridge = installBridge();
    renderModal({ in: null, out: null });
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0]).toMatchObject({
      outPath: '/exports/a.mp4',
      range: null,
    });
  });

  it('exports the full recording when a stale segment is no longer engaged', async () => {
    const bridge = installBridge();
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
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(bridge.startExport).toHaveBeenCalledTimes(1));
    expect(bridge.startExport.mock.calls[0][0].range).toBeNull();
  });
});

describe('ExportModal secondary buttons', () => {
  it('styles Cancel with the shared modal button class', () => {
    installBridge();
    renderModal({ in: null, out: null });
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('modal-button');
  });
});
