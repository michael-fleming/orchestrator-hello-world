'use strict';

const http = require('node:http');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app.handler);

const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ level: 'info', msg, ...extra }));

server.listen(config.port, () => {
  log('listening', {
    port: config.port,
    version: config.version,
    gitSha: config.gitSha,
    environment: config.environment,
    startupDelayMs: config.startupDelayMs,
    shutdownDelayMs: config.shutdownDelayMs,
  });
});

// Graceful shutdown: flip /readyz to 503 first so load balancers drain us,
// wait SHUTDOWN_DELAY_MS, then stop accepting connections and exit.
let stopping = false;

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('shutdown_start', { signal, drainMs: config.shutdownDelayMs });
  app.beginShutdown();

  setTimeout(() => {
    server.close(() => {
      log('shutdown_complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  }, config.shutdownDelayMs);

  // Safety net so a stuck connection can't block a rollout forever.
  setTimeout(() => process.exit(1), config.shutdownDelayMs + 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
