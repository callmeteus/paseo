#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export PASEO_LISTEN="${PASEO_LISTEN:-0.0.0.0:6768}"
export PASEO_HOSTNAMES="${PASEO_HOSTNAMES:-true}"
configure_dev_paseo_home

EXPO_PORT="${EXPO_PORT:-8081}"
DAEMON_ENDPOINT="$(resolve_dev_app_daemon_endpoint)"
TAILSCALE_IP="$(dev_tailscale_ipv4 || true)"
DEV_BUILD_LABEL="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

echo "══════════════════════════════════════════════════════"
echo "  Paseo App Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:   http://localhost:${EXPO_PORT}"
if [ -n "$TAILSCALE_IP" ]; then
  echo "  Tailnet: http://${TAILSCALE_IP}:${EXPO_PORT}"
fi
echo "  Daemon:  ${DAEMON_ENDPOINT}"
echo "  Home:    ${PASEO_HOME}"
echo "══════════════════════════════════════════════════════"

exec cross-env \
  BROWSER="${BROWSER:-none}" \
  APP_VARIANT=development \
  EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL="$DEV_BUILD_LABEL" \
  EXPO_PUBLIC_LOCAL_DAEMON="$DAEMON_ENDPOINT" \
  npm run start:expo --workspace=@getpaseo/app -- --port "$EXPO_PORT" --host lan
