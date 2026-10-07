#!/usr/bin/env bash
set -euo pipefail

OLLAMA_URL="http://127.0.0.1:11434"
WEBUI_URL="http://127.0.0.1:3000"
WEBUI_BIN="/home/ubuntu/.local-ai/venv/bin/open-webui"
TMUX_CONF="/exec-daemon/tmux.portal.conf"

tmux_cmd() {
  tmux -f "$TMUX_CONF" "$@"
}

ensure_ollama() {
  if curl -fsS "$OLLAMA_URL/" >/dev/null 2>&1; then
    return 0
  fi

  if ! tmux_cmd has-session -t "=ollama-server" 2>/dev/null; then
    tmux_cmd new-session -d -s "ollama-server" -c "$HOME" -- "${SHELL:-bash}" -l
  fi

  tmux_cmd send-keys -t "ollama-server:0.0" 'ollama serve' C-m

  for _ in $(seq 1 30); do
    if curl -fsS "$OLLAMA_URL/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  notify-send "Local AI" "Ollama failed to start." 2>/dev/null || true
  exit 1
}

ensure_webui() {
  if curl -fsS "$WEBUI_URL/" >/dev/null 2>&1; then
    return 0
  fi

  if ! tmux_cmd has-session -t "=open-webui" 2>/dev/null; then
    tmux_cmd new-session -d -s "open-webui" -c "$HOME" -- "${SHELL:-bash}" -l
  fi

  tmux_cmd send-keys -t "open-webui:0.0" \
    "export OLLAMA_BASE_URL=$OLLAMA_URL; $WEBUI_BIN serve --host 127.0.0.1 --port 3000" C-m

  for _ in $(seq 1 60); do
    if curl -fsS "$WEBUI_URL/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  notify-send "Local AI" "Chat UI failed to start." 2>/dev/null || true
  exit 1
}

ensure_ollama
ensure_webui

if command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome --new-window "$WEBUI_URL"
elif command -v x-www-browser >/dev/null 2>&1; then
  exec x-www-browser "$WEBUI_URL"
else
  exec xdg-open "$WEBUI_URL"
fi
