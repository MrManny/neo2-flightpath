export const ERROR_PREFIX = '[neo2-flightpath] ERROR: ';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
