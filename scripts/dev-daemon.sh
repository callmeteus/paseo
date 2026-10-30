#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export PASEO_LISTEN="${PASEO_LISTEN:-0.0.0.0:6768}"
export PASEO_HOSTNAMES="${PASEO_HOSTNAMES:-true}"
configure_dev_paseo_home
TAILSCALE_IP="$(dev_tailscale_ipv4 || true)"

if [ -z "${PASEO_LOCAL_MODELS_DIR}" ]; then
  export PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech"
  mkdir -p "$PASEO_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Paseo Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${PASEO_HOME}"
echo "  Models:  ${PASEO_LOCAL_MODELS_DIR}"
echo "  Listen:  ${PASEO_LISTEN}"
if [ -n "$TAILSCALE_IP" ]; then
  echo "  Tailnet: http://${TAILSCALE_IP}:${PASEO_LISTEN##*:}"
fi
echo "══════════════════════════════════════════════════════"

export PASEO_CORS_ORIGINS="${PASEO_CORS_ORIGINS:-*}"
export PASEO_NODE_INSPECT="${PASEO_NODE_INSPECT:---inspect=0}"

if [ "${PASEO_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
