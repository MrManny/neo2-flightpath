// The Open flow behind one event: pick a recording, load its prepared
// session, commit it to the UI. The flow returns the pickstate event to
// dispatch, and its stages only touch the app bridge through injected
// dependencies, so the whole flow runs without the DOM.
import type { PickResult, UiSession } from '../../src/appsession.js';
import { errorMessage } from '../../src/errors.js';
import type { PickEvent } from './pickstate.js';

export interface PickFlowDeps {
  pickRecording(): Promise<PickResult>;
  getSession(): Promise<UiSession | null>;
}

// The native dialog covers this stage, so nothing is shown yet.
async function pick(deps: PickFlowDeps): Promise<PickEvent | null> {
  const result = await deps.pickRecording();
  if (result.canceled) return { type: 'canceled' };
  if (!result.ok) return { type: 'failed', message: result.error ?? 'unknown error' };
  return null;
}

async function loadSession(deps: PickFlowDeps): Promise<UiSession | PickEvent> {
  const session = await deps.getSession();
  return session === null ? { type: 'failed', message: 'no recording loaded' } : session;
}

export async function pickRecordingFlow(
  deps: PickFlowDeps,
  commit: (session: UiSession) => void,
): Promise<PickEvent> {
  try {
    const picked = await pick(deps);
    if (picked !== null) return picked;
    const loaded = await loadSession(deps);
    if ('type' in loaded) return loaded;
    commit(loaded);
    return { type: 'picked' };
  } catch (e) {
    return { type: 'failed', message: errorMessage(e) };
  }
}
