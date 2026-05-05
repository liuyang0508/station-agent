/**
 * Circuit Breaker — Prevents cascading failures
 *
 * State machine:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

export const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;      // Failures before opening
    this.successThreshold = options.successThreshold || 2;     // Successes to close
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;     // Max probings in half_open
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;     // Time before trying half_open

    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.halfOpenCalls = 0;
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} - Result of the function
   * @throws {Error} - If circuit is OPEN or function fails
   */
  async execute(fn) {
    if (this.state === CircuitState.OPEN) {
      if (this._shouldAttemptReset()) {
        this._transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        throw new Error('Circuit breaker probing limit reached');
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  _shouldAttemptReset() {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.resetTimeoutMs;
  }

  _onSuccess() {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this._transitionTo(CircuitState.CLOSED);
      }
    }
  }

  _onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half_open trips the circuit back to open
      this._transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.failureThreshold) {
      this._transitionTo(CircuitState.OPEN);
    }
  }

  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.CLOSED) {
      this.failures = 0;
      this.successes = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenCalls = 0;
      this.successes = 0;
    }

    console.log(`[CircuitBreaker] ${oldState} -> ${newState}`);
  }

  getState() {
    return this.state;
  }

  reset() {
    this._transitionTo(CircuitState.CLOSED);
  }
}

/**
 * Create a circuit breaker with named registry for MCP/runtime use
 */
const breakers = new Map();

export function getCircuitBreaker(name, options) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(options));
  }
  return breakers.get(name);
}

export function resetAllCircuitBreakers() {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
}
