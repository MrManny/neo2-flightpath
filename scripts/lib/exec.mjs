// Single child-process entry point for the scripts/ helpers: every external
// command runs through here so the platform quirks live in one place.
// Children run hidden (windowsHide) on Windows — console-subsystem children
// otherwise pop up a console window when the parent has none — and npm gets
// its required shell handling here too.
import { spawnSync } from 'node:child_process';

export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Runs a command and returns the raw spawnSync-style result (utf8 output,
// never throws). Callers that want throw-on-failure use execOrThrow below.
export function exec(command, args = [], options = {}) {
  const settings = {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    ...options,
  };
  if (command !== npm) return spawnSync(command, args, settings);
  // npm is a .cmd shim on Windows, which Node only spawns via a shell; a
  // joined command string avoids the DEP0190 args-with-shell warning. The
  // callers pass fixed argument lists, so nothing user-supplied is joined.
  return spawnSync([command, ...args].join(' '), { ...settings, shell: true });
}

// Runs a command and returns its stdout, or throws a plain Error whose message
// carries the failure output (and also as .stdout/.stderr on the error).
export function execOrThrow(command, args = [], options = {}) {
  const result = exec(command, args, options);
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    const error = new Error(`${command} exited with status ${result.status}${detail ? `: ${detail}` : ''}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout ?? '';
}
