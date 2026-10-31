// =====================================================================
// Provider error taxonomy. The worker's retry and fallback decisions are
// driven only by these flags, never by parsing error strings.
// =====================================================================

export type ProviderErrorCode =
  | 'NOT_CONFIGURED' // no key / no endpoint: nothing was sent
  | 'REJECTED' // provider refused the request (4xx): no task was created
  | 'INSUFFICIENT_CREDIT'
  | 'TRANSIENT' // network error, timeout, 429, 5xx: safe to retry the same step
  | 'TASK_FAILED' // provider accepted the task and reported failure (may have been billed)
  | 'OUTPUT_EXPIRED' // output link no longer valid: re-poll for a fresh one
  | 'DOWNLOAD_FAILED'
  | 'UNSAFE_URL'
  | 'ENGINE_ERROR'
  | 'GEOMETRY_INVALID'
  | 'TIMEOUT';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    /** retrying the *same* step cannot create a second paid task */
    public readonly retryable = false,
    /** a provider task may exist (and may be billed) for this request */
    public readonly taskMayExist = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Wrap low-level fetch failures (DNS, reset, abort) as transient errors. */
export function asProviderError(e: unknown, context: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ProviderError('TRANSIENT', `${context}: ${msg}`, true);
}
