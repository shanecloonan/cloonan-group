#!/usr/bin/env bash
# Add Local AI launcher to the XFCE bottom panel (left side).
set -euo pipefail

HOME_DIR="${HOME:-/home/ubuntu}"
APPS_DESKTOP="$HOME_DIR/.local/share/applications/local-ai.desktop"

if ! command -v xfconf-query >/dev/null 2>&1; then
  echo "xfconf-query not found; skipping panel launcher."
  exit 0
fi

if [ ! -f "$APPS_DESKTOP" ]; then
  echo "Application desktop file missing; run install-local-ai.sh first."
  exit 1
fi

# Enable desktop file icons on the wallpaper.
xfconf-query -c xfce4-desktop -p /desktop-icons/style -s 2 2>/dev/null || true
xfconf-query -c xfce4-desktop -p /desktop-icons/file-icons -s true 2>/dev/null || true

# Register launcher plugin if missing.
if ! xfconf-query -c xfce4-panel -p /plugins/plugin-6 -v >/dev/null 2>&1; then
  xfconf-query -c xfce4-panel -p /plugins/plugin-6 -n -t string -s launcher
fi

xfconf-query -c xfce4-panel -p /plugins/plugin-6/items -r 2>/dev/null || true
xfconf-query -c xfce4-panel -p /plugins/plugin-6/items -t string -s "-$APPS_DESKTOP" --create

# Put launcher first on the bottom panel.
xfconf-query -c xfce4-panel -p /panels/panel-1/plugin-ids -r 2>/dev/null || true
xfconf-query -c xfce4-panel -p /panels/panel-1/plugin-ids \
  -t int -t int -t int -t int -t int -t int \
  -s 6 -s 1 -s 2 -s 3 -s 4 -s 5 --create

DISPLAY="${DISPLAY:-:1}" xfce4-panel -r 2>/dev/null || true
DISPLAY="${DISPLAY:-:1}" xfdesktop --reload 2>/dev/null || true

echo "Local AI launcher added to the bottom panel."
