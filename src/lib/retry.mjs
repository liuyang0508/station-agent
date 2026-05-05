/**
 * Retry — Exponential backoff retry logic
 */

export class RetryError extends Error {
  constructor(message, attempts, lastError) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
  retryableErrors: [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'NETWORK_ERROR',
    'TIMEOUT'
  ]
};

/**
 * Determine if an error is retryable
 */
function isRetryable(error, retryableErrors) {
  if (!error) return false;

  const errorCode = error.code || error.errno || '';
  const errorMessage = error.message || '';

  // Check error code
  if (retryableErrors.includes(errorCode)) {
    return true;
  }

  // Check error message patterns
  const retryablePatterns = [
    /connection refused/i,
    /connection reset/i,
    /timeout/i,
    /network error/i,
    /temporary failure/i,
    /service unavailable/i,
    /too many requests/i,
    /rate limit/i
  ];

  for (const pattern of retryablePatterns) {
    if (pattern.test(errorMessage)) {
      return true;
    }
  }

  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} - Result of the function
 */
export async function retry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === opts.maxAttempts;
      const shouldRetry = isRetryable(error, opts.retryableErrors) && !isLastAttempt;

      if (!shouldRetry) {
        throw error;
      }

      console.log(`[Retry] Attempt ${attempt}/${opts.maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`);

      await sleep(delay);

      // Apply jitter to prevent thundering herd
      const jitter = Math.random() * 0.3 * delay;
      delay = Math.min((delay + jitter) * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw new RetryError(
    `Failed after ${opts.maxAttempts} attempts: ${lastError.message}`,
    opts.maxAttempts,
    lastError
  );
}

/**
 * Create a retry wrapper with preset options for specific use cases
 */
export function createRetry(options) {
  return (fn) => retry(fn, options);
}

// Presets for common use cases
export const retryPresets = {
  // Quick retry for transient errors (5 attempts, 100ms base)
  quick: {
    maxAttempts: 5,
    initialDelayMs: 100,
    backoffMultiplier: 2,
    maxDelayMs: 2000
  },

  // Standard retry for API calls (3 attempts, 500ms base)
  standard: {
    maxAttempts: 3,
    initialDelayMs: 500,
    backoffMultiplier: 2,
    maxDelayMs: 10000
  },

  // Aggressive retry for critical operations (5 attempts, 1000ms base)
  aggressive: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000
  }
};
