#!/bin/bash
# Never trust a restart.
#
# The previous version used `pkill -f "node.*scrawl.*server"`, which does not
# match the real command line (`node server/index.js`, cwd /home/kit/scrawl).
# The old process survived every "restart" and kept serving stale code on the
# port while the script happily printed success. Kill by listening PID, wait
# for the port to actually free, refuse to continue if it does not, then assert
# a route that only the current code can answer.
set -euo pipefail

cd /home/kit/scrawl
PORT="${PORT:-8527}"

pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$pids" ]; then
  echo "stopping $(echo "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
fi

for _ in $(seq 1 25); do
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.2
done

if lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  kill -9 $(lsof -ti "tcp:${PORT}" -sTCP:LISTEN) 2>/dev/null || true
  sleep 1
fi

if lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is still held; refusing to start a second server" >&2
  exit 1
fi

# Scope the env to this one command. Sourcing .env into the shell leaks
# NODE_ENV=development into any build run later in the same session.
set -a; . ./.env; set +a
NODE_ENV=production PORT="$PORT" node server/index.js >/tmp/scrawl.log 2>&1 &
started=$!

for _ in $(seq 1 30); do
  sleep 0.3
  curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1 && break
done

if ! curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo "server did not come up; see /tmp/scrawl.log" >&2
  tail -20 /tmp/scrawl.log >&2 || true
  exit 1
fi

# Proof the running build is the current one: /api/folders only exists in the
# notes release, and it must answer 401 without a token.
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/folders")"
if [ "$code" != "401" ]; then
  echo "stale build on port ${PORT}: /api/folders returned ${code}, expected 401" >&2
  exit 1
fi

# Second proof, this one for the shell release: /sw.js must be real JS served
# with no-cache. Before this release the SPA fallback answered with HTML.
sw_headers="$(curl -sI "http://localhost:${PORT}/sw.js")"
if ! grep -qi 'content-type: application/javascript' <<<"$sw_headers"; then
  echo "stale build on port ${PORT}: /sw.js is not served as JavaScript" >&2
  echo "$sw_headers" >&2
  exit 1
fi
if ! grep -qi 'cache-control: no-cache' <<<"$sw_headers"; then
  echo "stale build on port ${PORT}: /sw.js is missing no-cache" >&2
  exit 1
fi

echo "Scrawl running on ${PORT} (pid ${started}), notes routes + service worker confirmed live"
