#!/usr/bin/env bash
# Rebuild the desktop .deb from this checkout and install it. Uses PolicyKit's
# graphical password prompt when `pkexec` is available (typical GNOME/KDE).
# Fallback: `sudo` in this terminal when `pkexec` is missing.
#
# Usage (repo root):
#   ./scripts/reinstall-desktop-linux.sh
#   ./scripts/reinstall-desktop-linux.sh --skip-build
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/packages/desktop/release"

usage() {
  echo "Usage: $0 [--skip-build]" >&2
  exit 2
}

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h | --help) usage ;;
    *) echo "Unknown option: $arg" >&2; usage ;;
  esac
done

latest_amd64_deb() {
  # electron-builder: Paseo-${version}-amd64.deb
  local f
  f="$(ls -t "${RELEASE_DIR}"/Paseo-*-amd64.deb 2>/dev/null | head -1 || true)"
  if [[ -z "$f" || ! -f "$f" ]]; then
    echo "[reinstall-desktop-linux] No Paseo-*-amd64.deb in ${RELEASE_DIR}. Run npm run build:desktop first." >&2
    exit 1
  fi
  printf '%s' "$f"
}

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "[reinstall-desktop-linux] Building desktop (npm run build:desktop) ..."
  (cd "$REPO_ROOT" && npm run build:desktop)
fi

DEB_PATH="$(latest_amd64_deb)"
echo "[reinstall-desktop-linux] Installer: $DEB_PATH"

if command -v pkexec >/dev/null 2>&1; then
  echo "[reinstall-desktop-linux] pkexec: graphical password prompt (PolicyKit)"
  pkexec env DEBIAN_FRONTEND=noninteractive apt-get install -y "$DEB_PATH"
elif command -v sudo >/dev/null 2>&1; then
  echo "[reinstall-desktop-linux] pkexec not found; using sudo in this terminal." >&2
  echo "[reinstall-desktop-linux] Install policykit-1 (Debian/Ubuntu) for a graphical prompt next time." >&2
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$DEB_PATH"
else
  echo "[reinstall-desktop-linux] Neither pkexec nor sudo found. Run as root:" >&2
  echo "  apt-get install -y '$DEB_PATH'" >&2
  exit 1
fi

PASEO_BIN="/opt/Paseo/Paseo"
if [[ -x "$PASEO_BIN" ]] && ! pgrep -x Paseo >/dev/null 2>&1; then
  echo "[reinstall-desktop-linux] Starting Paseo..."
  setsid -f "$PASEO_BIN" >/dev/null 2>&1 || true
fi

echo "[reinstall-desktop-linux] Done."
