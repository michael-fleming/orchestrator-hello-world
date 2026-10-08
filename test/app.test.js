'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(env = {}) {
  const app = createApp(
    loadConfig({
      ACCESS_LOG: 'false',
      APP_VERSION: '9.9.9',
      GIT_SHA: 'abc1234',
      APP_ENV: 'test',
      APP_COLOR: '#ff0000',
      APP_MESSAGE: 'Hi <there>',
      ...env,
    }),
  );
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  return { app, base, close };
}

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('liveness and readiness are healthy by default', async () => {
  const { base, close } = await startServer();
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
  } finally {
    await close();
  }
});

test('/api/version reports build info and sets version headers', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/version`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-app-version'), '9.9.9');
    assert.ok(res.headers.get('x-served-by'));

    const body = await res.json();
    assert.equal(body.version, '9.9.9');
    assert.equal(body.gitSha, 'abc1234');
    assert.equal(body.environment, 'test');
    assert.ok(body.hostname);
    assert.ok(Date.parse(body.startedAt));
  } finally {
    await close();
  }
});

test('index page is rendered with version, color and escaped message', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);

    const html = await res.text();
    assert.ok(html.includes('9.9.9'));
    assert.ok(html.includes('--accent: #ff0000'));
    assert.ok(html.includes('Hi &lt;there&gt;'));
    assert.ok(!html.includes('{{'), 'no unreplaced placeholders');
  } finally {
    await close();
  }
});

test('static assets are served with the right content types', async () => {
  const { base, close } = await startServer();
  try {
    const css = await fetch(`${base}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
  } finally {
    await close();
  }
});

test('unknown pages and API routes return 404', async () => {
  const { base, close } = await startServer();
  try {
    const page = await fetch(`${base}/nope`);
    assert.equal(page.status, 404);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.ok((await page.text()).includes('9.9.9'));

    const api = await fetch(`${base}/api/nope`);
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: 'not_found' });
  } finally {
    await close();
  }
});

test('path traversal and malformed paths are rejected', async () => {
  const { base, close } = await startServer();
  try {
    const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
    assert.notEqual(traversal.status, 200);

    const nullByte = await fetch(`${base}/%00`);
    assert.equal(nullByte.status, 400);

    const badEncoding = await fetch(`${base}/%E0%A4%A`);
    assert.equal(badEncoding.status, 400);
  } finally {
    await close();
  }
});

test('non-GET requests to read-only routes get 405', async () => {
  const { base, close } = await startServer();
  try {
    const res = await post(`${base}/api/version`, {});
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  } finally {
    await close();
  }
});

test('chaos "unready" fails readiness but not liveness', async () => {
  const { base, close } = await startServer();
  try {
    assert.equal((await post(`${base}/api/chaos`, { mode: 'unready' })).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);

    await post(`${base}/api/chaos`, { mode: 'off' });
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
  } finally {
    await close();
  }
});

test('chaos "unhealthy" fails both probes', async () => {
  const { base, close } = await startServer();
  try {
    await post(`${base}/api/chaos`, { mode: 'unhealthy' });
    assert.equal((await fetch(`${base}/healthz`)).status, 503);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
  } finally {
    await close();
  }
});

test('chaos "errors" breaks the API but chaos control stays reachable', async () => {
  const { base, close } = await startServer();
  try {
    await post(`${base}/api/chaos`, { mode: 'errors', errorRate: 1 });
    assert.equal((await fetch(`${base}/api/version`)).status, 500);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);

    const reset = await post(`${base}/api/chaos`, { mode: 'off' });
    assert.equal(reset.status, 200);
    assert.equal((await fetch(`${base}/api/version`)).status, 200);
  } finally {
    await close();
  }
});

test('chaos "slow" adds latency to API calls', async () => {
  const { base, close } = await startServer();
  try {
    await post(`${base}/api/chaos`, { mode: 'slow', delayMs: 250 });
    const started = Date.now();
    const res = await fetch(`${base}/api/hello`);
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started >= 200, 'response should be delayed');
  } finally {
    await close();
  }
});

test('invalid chaos input is rejected with 400', async () => {
  const { base, close } = await startServer();
  try {
    assert.equal((await post(`${base}/api/chaos`, { mode: 'nope' })).status, 400);
    assert.equal((await post(`${base}/api/chaos`, { delayMs: -5 })).status, 400);

    const badJson = await fetch(`${base}/api/chaos`, { method: 'POST', body: '{oops' });
    assert.equal(badJson.status, 400);
  } finally {
    await close();
  }
});

test('ENABLE_CHAOS=false hides the chaos endpoint', async () => {
  const { base, close } = await startServer({ ENABLE_CHAOS: 'false' });
  try {
    assert.equal((await fetch(`${base}/api/chaos`)).status, 404);
    assert.equal((await post(`${base}/api/chaos`, { mode: 'errors' })).status, 404);
  } finally {
    await close();
  }
});

test('STARTUP_DELAY_MS keeps /readyz at 503 until the delay passes', async () => {
  const { base, close } = await startServer({ STARTUP_DELAY_MS: '150' });
  try {
    const early = await fetch(`${base}/readyz`);
    assert.equal(early.status, 503);
    assert.deepEqual(await early.json(), { status: 'starting' });
    assert.equal((await fetch(`${base}/healthz`)).status, 200);

    await sleep(300);
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
  } finally {
    await close();
  }
});

test('beginShutdown makes /readyz report draining', async () => {
  const { app, base, close } = await startServer();
  try {
    app.beginShutdown();
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'draining' });
  } finally {
    await close();
  }
});
