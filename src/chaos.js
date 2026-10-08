'use strict';

const MODES = {
  off: 'Normal behavior',
  slow: 'Adds latency to every /api/* response',
  errors: 'Returns random 500s from /api/* routes',
  unready: '/readyz returns 503 (traffic should drain away)',
  unhealthy: '/healthz and /readyz return 503 (should trigger a restart)',
};

/**
 * Runtime-switchable failure modes, so you can check how your platform
 * reacts to a bad instance without redeploying anything.
 */
function createChaos() {
  const state = { mode: 'off', delayMs: 1500, errorRate: 0.5 };

  return {
    get() {
      return { ...state, modes: MODES };
    },

    set(input) {
      if (input === null || typeof input !== 'object') {
        return { error: 'body must be a JSON object' };
      }
      const next = { ...state };

      if (input.mode !== undefined) {
        if (!Object.hasOwn(MODES, input.mode)) {
          return { error: `mode must be one of: ${Object.keys(MODES).join(', ')}` };
        }
        next.mode = input.mode;
      }
      if (input.delayMs !== undefined) {
        if (!Number.isFinite(input.delayMs) || input.delayMs < 0 || input.delayMs > 30000) {
          return { error: 'delayMs must be a number between 0 and 30000' };
        }
        next.delayMs = input.delayMs;
      }
      if (input.errorRate !== undefined) {
        if (!Number.isFinite(input.errorRate) || input.errorRate < 0 || input.errorRate > 1) {
          return { error: 'errorRate must be a number between 0 and 1' };
        }
        next.errorRate = input.errorRate;
      }

      Object.assign(state, next);
      return { ok: true };
    },
  };
}

module.exports = { createChaos, MODES };
