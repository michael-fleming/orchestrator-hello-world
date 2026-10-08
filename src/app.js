'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const pkg = require('../package.json');
const { createChaos } = require('./chaos');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { status: 413 }));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createApp(config) {
  const startedAt = new Date();
  const chaos = createChaos();
  const state = { ready: config.startupDelayMs <= 0, shuttingDown: false };

  if (!state.ready) {
    setTimeout(() => {
      state.ready = true;
    }, config.startupDelayMs).unref();
  }

  function versionInfo() {
    return {
      name: pkg.name,
      version: config.version,
      gitSha: config.gitSha,
      buildTime: config.buildTime,
      environment: config.environment,
      color: config.color,
      message: config.message,
      hostname: os.hostname(),
      pid: process.pid,
      node: process.version,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    };
  }

  function readiness() {
    const { mode } = chaos.get();
    if (state.shuttingDown) return 'draining';
    if (!state.ready) return 'starting';
    if (mode === 'unready' || mode === 'unhealthy') return 'unready';
    return 'ready';
  }

  // Fills in the {{PLACEHOLDERS}} used by the HTML pages in /public.
  function render(html) {
    return html
      .replaceAll('{{VERSION}}', escapeHtml(config.version))
      .replaceAll('{{COLOR}}', config.color)
      .replaceAll('{{MESSAGE}}', escapeHtml(config.message))
      .replaceAll('{{ENVIRONMENT}}', escapeHtml(config.environment));
  }

  function allow(req, res, methods) {
    if (methods.includes(req.method)) return true;
    res.setHeader('Allow', methods.join(', '));
    sendJson(res, 405, { error: 'method_not_allowed' });
    return false;
  }

  async function applyChaos(res) {
    const { mode, delayMs, errorRate } = chaos.get();
    if (mode === 'slow') await sleep(delayMs);
    if (mode === 'errors' && Math.random() < errorRate) {
      sendJson(res, 500, { error: 'chaos_injected' });
      return true;
    }
    return false;
  }

  async function sendNotFoundPage(res) {
    let body = 'Not found';
    try {
      body = render(await fs.readFile(path.join(PUBLIC_DIR, '404.html'), 'utf8'));
    } catch {
      // fall back to the plain message
    }
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async function serveStatic(req, res, urlPath) {
    if (!allow(req, res, ['GET', 'HEAD'])) return;

    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    if (decoded.includes('\0')) return sendJson(res, 400, { error: 'bad_request' });

    const rel = decoded === '/' ? '/index.html' : decoded;
    const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      return sendJson(res, 403, { error: 'forbidden' });
    }

    let data;
    try {
      data = await fs.readFile(filePath);
    } catch {
      return sendNotFoundPage(res);
    }

    const ext = path.extname(filePath).toLowerCase();
    const body = ext === '.html' ? Buffer.from(render(data.toString('utf8'))) : data;
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }

  async function handle(req, res, urlPath) {
    res.setHeader('X-App-Version', config.version);
    res.setHeader('X-Served-By', os.hostname());
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (urlPath === '/healthz') {
      if (!allow(req, res, ['GET', 'HEAD'])) return;
      const unhealthy = chaos.get().mode === 'unhealthy';
      return sendJson(res, unhealthy ? 503 : 200, { status: unhealthy ? 'unhealthy' : 'ok' });
    }

    if (urlPath === '/readyz') {
      if (!allow(req, res, ['GET', 'HEAD'])) return;
      const status = readiness();
      return sendJson(res, status === 'ready' ? 200 : 503, { status });
    }

    // Always reachable (never affected by chaos) so you can turn chaos off again.
    if (urlPath === '/api/chaos') {
      if (!config.chaosEnabled) return sendJson(res, 404, { error: 'not_found' });
      if (req.method === 'GET') return sendJson(res, 200, chaos.get());
      if (req.method === 'POST') {
        const result = chaos.set(await readJson(req));
        if (result.error) return sendJson(res, 400, { error: result.error });
        console.log(JSON.stringify({ level: 'warn', msg: 'chaos_updated', mode: chaos.get().mode }));
        return sendJson(res, 200, chaos.get());
      }
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (urlPath.startsWith('/api/')) {
      if (!allow(req, res, ['GET', 'HEAD'])) return;
      if (await applyChaos(res)) return;

      if (urlPath === '/api/version') return sendJson(res, 200, versionInfo());
      if (urlPath === '/api/hello') {
        return sendJson(res, 200, {
          message: config.message,
          version: config.version,
          time: new Date().toISOString(),
        });
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    return serveStatic(req, res, urlPath);
  }

  function handler(req, res) {
    const urlPath = (req.url || '/').split('?')[0];
    const started = process.hrtime.bigint();

    if (config.accessLog && urlPath !== '/healthz' && urlPath !== '/readyz') {
      res.on('finish', () => {
        console.log(
          JSON.stringify({
            level: 'info',
            msg: 'request',
            method: req.method,
            path: urlPath,
            status: res.statusCode,
            ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
          }),
        );
      });
    }

    handle(req, res, urlPath).catch((err) => {
      const status = err.status || 500;
      if (status === 500) {
        console.error(JSON.stringify({ level: 'error', msg: err.message }));
      }
      if (res.headersSent) return res.end();
      sendJson(res, status, { error: status === 500 ? 'internal_error' : err.message });
    });
  }

  return {
    handler,
    chaos,
    beginShutdown() {
      state.shuttingDown = true;
    },
  };
}

module.exports = { createApp };
