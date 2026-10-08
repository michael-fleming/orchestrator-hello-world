(() => {
  'use strict';

  const POLL_MS = 2000;
  const TIMEOUT_MS = 5000;
  const MAX_LOG_ENTRIES = 60;

  const $ = (id) => document.getElementById(id);
  const pageVersion = document.querySelector('meta[name="app-version"]').content;

  const state = {
    paused: false,
    timer: null,
    up: null, // null until the first response, then true/false
    downSince: null,
    version: null,
    instance: null,
    uptimeBase: 0,
    uptimeAt: 0,
    requests: 0,
    failures: 0,
  };

  // ---------- helpers ----------

  function addLog(kind, text) {
    const li = document.createElement('li');
    li.className = kind;
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString();
    const span = document.createElement('span');
    span.textContent = text;
    li.append(time, span);

    const list = $('log');
    list.prepend(li);
    while (list.children.length > MAX_LOG_ENTRIES) list.lastChild.remove();
  }

  function formatDuration(ms) {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  }

  function formatUptime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function refreshStatus() {
    let kind = 'connecting';
    let text = 'Connecting…';
    if (state.paused) [kind, text] = ['paused', 'Paused'];
    else if (state.up === true) [kind, text] = ['up', 'Healthy'];
    else if (state.up === false) [kind, text] = ['down', 'Unreachable'];
    $('status').dataset.state = kind;
    $('statusText').textContent = text;
  }

  function renderStats(latencyMs) {
    if (latencyMs !== undefined) $('statLatency').textContent = `${latencyMs} ms`;
    $('statRequests').textContent = String(state.requests);
    const ok = state.requests - state.failures;
    $('statAvail').textContent =
      state.requests === 0 ? '—' : `${((ok / state.requests) * 100).toFixed(1)}%`;
  }

  function renderInstance(data) {
    $('vVersion').textContent = `v${data.version}`;
    $('vSha').textContent = String(data.gitSha).slice(0, 12);
    $('vHost').textContent = data.hostname;
    $('vStarted').textContent = new Date(data.startedAt).toLocaleString();
    $('vBuilt').textContent = data.buildTime ? new Date(data.buildTime).toLocaleString() : 'not set';
  }

  function updateBanner(liveVersion) {
    const banner = $('banner');
    if (liveVersion !== pageVersion) {
      $('bannerText').textContent =
        `A different version is live (v${liveVersion}). This page was loaded from v${pageVersion}.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  // ---------- polling ----------

  function onSuccess(data, latencyMs) {
    if (state.up === false) {
      addLog('ok', `Recovered after ${formatDuration(Date.now() - state.downSince)} of downtime`);
    }
    state.up = true;
    state.downSince = null;

    const instance = `${data.hostname}|${data.startedAt}`;
    if (state.version === null) {
      addLog('info', `Connected to v${data.version} on ${data.hostname}`);
    } else if (data.version !== state.version) {
      addLog('change', `Version changed: v${state.version} → v${data.version} (${data.hostname})`);
    } else if (instance !== state.instance) {
      addLog('change', `Different instance responding: ${data.hostname} (started ${new Date(data.startedAt).toLocaleTimeString()})`);
    }
    state.version = data.version;
    state.instance = instance;
    state.uptimeBase = data.uptimeSeconds;
    state.uptimeAt = performance.now();

    renderInstance(data);
    updateBanner(data.version);
    renderStats(latencyMs);
  }

  function onFailure(reason) {
    state.failures += 1;
    if (state.up !== false) {
      state.downSince = Date.now();
      addLog('error', `Backend unreachable (${reason})`);
    }
    state.up = false;
    renderStats();
  }

  async function poll() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = performance.now();
    state.requests += 1;

    try {
      const res = await fetch('/api/version', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSuccess(await res.json(), Math.round(performance.now() - started));
    } catch (err) {
      onFailure(err.name === 'AbortError' ? 'timeout' : err.message);
    } finally {
      clearTimeout(timeout);
      refreshStatus();
      if (!state.paused) state.timer = setTimeout(poll, POLL_MS);
    }
  }

  $('pauseBtn').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause';
    if (state.paused) {
      clearTimeout(state.timer);
      addLog('info', 'Polling paused');
    } else {
      addLog('info', 'Polling resumed');
      poll();
    }
    refreshStatus();
  });

  $('reloadBtn').addEventListener('click', () => location.reload());

  setInterval(() => {
    if (state.up) {
      $('vUptime').textContent = formatUptime(state.uptimeBase + (performance.now() - state.uptimeAt) / 1000);
    }
  }, 1000);

  // ---------- failure injection ----------

  function renderChaos(config) {
    const box = $('chaosModes');
    box.replaceChildren();
    for (const mode of Object.keys(config.modes)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = mode;
      btn.setAttribute('aria-pressed', String(mode === config.mode));
      btn.addEventListener('click', () => setChaos(mode));
      box.append(btn);
    }
    $('chaosHelp').textContent = config.modes[config.mode];
  }

  async function loadChaos() {
    try {
      const res = await fetch('/api/chaos', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderChaos(await res.json());
    } catch {
      $('chaos').hidden = true; // chaos disabled (ENABLE_CHAOS=false) or unreachable
    }
  }

  async function setChaos(mode) {
    try {
      const res = await fetch('/api/chaos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderChaos(await res.json());
      addLog('warn', `Chaos mode set to "${mode}"`);
    } catch (err) {
      addLog('error', `Could not change chaos mode (${err.message})`);
    }
  }

  refreshStatus();
  loadChaos();
  poll();
})();
