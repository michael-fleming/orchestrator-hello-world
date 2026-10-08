'use strict';

const pkg = require('../package.json');

const DEFAULT_COLOR = '#2563eb';

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Everything the app needs comes from environment variables, so a "new
 * version" can be simulated by restarting with different values.
 */
function loadConfig(env = process.env) {
  const color = /^#[0-9a-f]{3,8}$/i.test(env.APP_COLOR || '')
    ? env.APP_COLOR
    : DEFAULT_COLOR;

  return {
    port: toInt(env.PORT, 3000),
    version: env.APP_VERSION || pkg.version,
    gitSha: env.GIT_SHA || 'dev',
    buildTime: env.BUILD_TIME || null,
    environment: env.APP_ENV || 'local',
    color,
    message: env.APP_MESSAGE || 'Hello, world!',
    startupDelayMs: toInt(env.STARTUP_DELAY_MS, 0),
    shutdownDelayMs: toInt(env.SHUTDOWN_DELAY_MS, 0),
    chaosEnabled: env.ENABLE_CHAOS !== 'false',
    accessLog: env.ACCESS_LOG !== 'false',
  };
}

module.exports = { loadConfig };
