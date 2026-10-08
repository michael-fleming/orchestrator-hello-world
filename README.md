# Deploy Canary

A small web app for testing deployments, rollouts, and app updates. It has no
dependencies, boots instantly, and makes it obvious *which version is serving
you*, so you can tell whether an update landed, rolled back, or is
half-deployed.

## Quick start

```bash
npm start            # http://localhost:3000
npm test             # node:test, no install step needed
npm run dev          # restart on file changes
```

Requires Node 20+. There is nothing to `npm install`.

## What's in it

- **Dashboard (`/`)**: shows the live version, git SHA, host, and uptime, and
  polls the server every 2 seconds. A built-in event log records version
  changes, instance swaps, downtime, and recovery time. A banner appears when
  the live version differs from the version that rendered your page (a stale
  tab during a rollout).
- **Version endpoint (`/api/version`)**: JSON with version, SHA, build time,
  hostname, start time, and uptime. Every response also carries
  `X-App-Version` and `X-Served-By` headers, so `curl -I` is enough.
- **Probes**: `/healthz` (liveness) and `/readyz` (readiness).
- **Failure injection**: flip an instance into a bad state at runtime.
- **Graceful shutdown**: on SIGTERM, `/readyz` flips to 503, the app waits
  `SHUTDOWN_DELAY_MS`, then exits.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /` | Dashboard (HTML is templated with the running version) |
| `GET /api/version` | Build and instance info |
| `GET /api/hello` | Tiny JSON greeting with the version |
| `GET /healthz` | Liveness: 200 unless chaos mode is `unhealthy` |
| `GET /readyz` | Readiness: 503 while starting, draining, or in chaos `unready`/`unhealthy` |
| `GET/POST /api/chaos` | Read or set the failure mode |

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `APP_VERSION` | `package.json` version | Version shown everywhere |
| `GIT_SHA` | `dev` | Commit SHA shown on the dashboard |
| `BUILD_TIME` | unset | ISO timestamp of the build |
| `APP_ENV` | `local` | Environment label |
| `APP_COLOR` | `#2563eb` | Accent color (hex), so versions look different |
| `APP_MESSAGE` | `Hello, world!` | Headline text |
| `STARTUP_DELAY_MS` | `0` | `/readyz` returns 503 for this long after boot |
| `SHUTDOWN_DELAY_MS` | `0` | Drain time between SIGTERM and exit |
| `ENABLE_CHAOS` | `true` | Set to `false` to disable `/api/chaos` |
| `ACCESS_LOG` | `true` | JSON request logs on stdout (probes are not logged) |

## Simulating an update

Run "v1" and "v2" side by side, or swap one for the other:

```bash
PORT=3000 APP_VERSION=1.0.0 APP_COLOR='#2563eb' npm start
PORT=3001 APP_VERSION=1.1.0 APP_COLOR='#16a34a' APP_MESSAGE='Hello, v1.1!' npm start
```

With the dashboard open on `:3000`, stop that server and start v1.1.0 on the
same port. The event log records the downtime, then the version change, and the
banner tells you the tab is stale.

From a terminal:

```bash
scripts/watch.sh http://localhost:3000 1
```

## Failure injection

```bash
curl -X POST localhost:3000/api/chaos -H 'content-type: application/json' \
  -d '{"mode":"unready"}'
```

| Mode | Effect |
| --- | --- |
| `off` | Normal behavior |
| `slow` | Adds `delayMs` (default 1500) to every `/api/*` response |
| `errors` | `/api/*` returns 500 with probability `errorRate` (default 0.5) |
| `unready` | `/readyz` returns 503; traffic should drain away |
| `unhealthy` | `/healthz` and `/readyz` return 503; should trigger a restart |

`/api/chaos` itself is never affected, so you can always turn chaos back off.
Chaos state is per instance and resets on restart. Set `ENABLE_CHAOS=false`
for anything that shouldn't expose it.

## Docker

```bash
docker build \
  --build-arg APP_VERSION=1.0.0 \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t deploy-canary:1.0.0 .

docker run --rm -p 3000:3000 deploy-canary:1.0.0
```

The image runs as a non-root user and includes a `HEALTHCHECK` against
`/healthz`.

## Kubernetes

`k8s/deployment.yaml` is a ready-made Deployment and Service with a zero-downtime
rolling update strategy, readiness and liveness probes, a simulated slow start,
and a drain delay. Adjust the image name to match your registry.

## Layout

```
server.js            entrypoint + graceful shutdown
src/app.js           routing, static files, templating
src/config.js        environment-based configuration
src/chaos.js         failure-injection state
public/              dashboard (HTML, CSS, JS) and 404 page
test/app.test.js     node:test suite
scripts/watch.sh     terminal rollout watcher
k8s/deployment.yaml  example manifest
Dockerfile
.github/workflows/   CI: tests on Node 20/22, image build, smoke test
```
