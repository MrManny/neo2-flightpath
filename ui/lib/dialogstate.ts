// Dialog visibility as one state machine: which dialog is open and whether it
// may be dismissed come from a single state, so Escape, the backdrop and the
// header close can never disagree. "export-form" covers every dismissable
// phase of the export dialog (form, done, canceled, error); a running job
// pins it as "export-running".
export type DialogState = 'closed' | 'settings' | 'export-form' | 'export-running';

export type DialogEvent =
  | { type: 'openSettings' }
  | { type: 'openExport' }
  | { type: 'exportStarted' }
  | { type: 'exportFinished' }
  | { type: 'close' };

/** The job-lifecycle slice the export modal feeds the machine. */
export type DialogRunEvent = Extract<DialogEvent, { type: 'exportStarted' | 'exportFinished' }>;

export function dialogReducer(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'openSettings':
      return state === 'export-running' ? state : 'settings';
    case 'openExport':
      return state === 'export-running' ? state : 'export-form';
    case 'exportStarted':
      return state === 'export-form' ? 'export-running' : state;
    case 'exportFinished':
      return state === 'export-running' ? 'export-form' : state;
    case 'close':
      return state === 'export-running' ? state : 'closed';
  }
}

// The one dismissal rule, for Escape, the backdrop and the header close.
export function canDismiss(state: DialogState): boolean {
  return state !== 'export-running';
}
