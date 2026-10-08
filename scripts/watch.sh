#!/usr/bin/env bash
# Poll a deployment and print which version/host answers each request.
# Handy for watching a rollout from the terminal.
#
# Usage: scripts/watch.sh [base-url] [interval-seconds]
set -u

URL="${1:-http://localhost:3000}"
INTERVAL="${2:-1}"

while true; do
  now="$(date +%H:%M:%S)"
  if body="$(curl -fsS --max-time 3 "$URL/api/version" 2>&1)"; then
    summary="$(printf '%s' "$body" | node -e '
      const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
      console.log(`v${j.version}  sha=${String(j.gitSha).slice(0, 7)}  host=${j.hostname}  up=${j.uptimeSeconds}s`);
    ' 2>/dev/null || echo "$body")"
    echo "$now  $summary"
  else
    echo "$now  DOWN  ($body)"
  fi
  sleep "$INTERVAL"
done
