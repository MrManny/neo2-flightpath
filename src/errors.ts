// errors.ts - turning unknown throw values into log lines.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
