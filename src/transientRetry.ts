import type { Logger } from './logger.js';

interface TransientRetryOptions<T> {
  step: string;
  maxAttempts: number;
  baseDelayMs: number;
  logger: Logger;
  operation: () => Promise<T>;
}

export async function retryTransientTimeout<T>(options: TransientRetryOptions<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await options.operation();
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || !isTransientTimeoutError(error)) {
        break;
      }

      const delayMs = calculateExponentialDelay(options.baseDelayMs, attempt);
      options.logger.warn('Transient request timeout; retrying', {
        step: options.step,
        retryAttempt: attempt,
        maxAttempts: options.maxAttempts,
        retryDelayMs: delayMs,
        errorReason: error instanceof Error ? error.message : String(error),
      });
      if (delayMs > 0) {
        await delay(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function calculateExponentialDelay(baseDelayMs: number, failedAttempt: number): number {
  return baseDelayMs * 2 ** (failedAttempt - 1);
}

function isTransientTimeoutError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (name === 'timeouterror' || name === 'aborterror') {
    return true;
  }

  if (message.includes('timed out') || message.includes('timeout') || message.includes('aborted due to timeout')) {
    return true;
  }

  const cause = error instanceof Error ? error.cause : undefined;
  return cause ? isTransientTimeoutError(cause) : false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
