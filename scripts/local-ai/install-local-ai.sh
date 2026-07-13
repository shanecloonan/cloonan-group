#!/usr/bin/env bash
# Install Ollama + Open WebUI and create a desktop launcher for local AI chat.
set -euo pipefail

HOME_DIR="${HOME:-/home/ubuntu}"
INSTALL_DIR="$HOME_DIR/.local-ai"
VENV_DIR="$INSTALL_DIR/venv"
BIN_DIR="$HOME_DIR/bin"
DESKTOP_DIR="$HOME_DIR/Desktop"
APPS_DIR="$HOME_DIR/.local/share/applications"
ICONS_DIR="$HOME_DIR/.local/share/icons"
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
MODEL="${LOCAL_AI_MODEL:-qwen2.5:0.5b}"
TMUX_CONF="/exec-daemon/tmux.portal.conf"

echo ">>> Installing dependencies..."
if ! command -v zstd >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq zstd python3.12-venv curl
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo ">>> Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$APPS_DIR" "$ICONS_DIR" "$AUTOSTART_DIR"

if [ ! -x "$VENV_DIR/bin/open-webui" ]; then
  echo ">>> Installing Open WebUI..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip -q
  "$VENV_DIR/bin/pip" install open-webui -q
fi

echo ">>> Downloading icon..."
curl -fsSL -o "$ICONS_DIR/ollama.png" \
  "https://raw.githubusercontent.com/ollama/ollama/main/docs/ollama.png"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -m 755 "$SCRIPT_DIR/local-ai-launch.sh" "$BIN_DIR/local-ai-launch.sh"
sed "s|/home/ubuntu|$HOME_DIR|g" "$SCRIPT_DIR/local-ai.desktop" > "$DESKTOP_DIR/Local AI.desktop"
sed "s|/home/ubuntu|$HOME_DIR|g" "$SCRIPT_DIR/local-ai.desktop" > "$APPS_DIR/local-ai.desktop"
sed "s|/home/ubuntu|$HOME_DIR|g" "$SCRIPT_DIR/ollama-serve.desktop" > "$AUTOSTART_DIR/ollama-serve.desktop"

chmod +x "$DESKTOP_DIR/Local AI.desktop"
update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo ">>> Starting Ollama..."
if ! curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1; then
  tmux -f "$TMUX_CONF" has-session -t "=ollama-server" 2>/dev/null \
    || tmux -f "$TMUX_CONF" new-session -d -s ollama-server -c "$HOME_DIR" -- "${SHELL:-bash}" -l
  tmux -f "$TMUX_CONF" send-keys -t ollama-server:0.0 'ollama serve' C-m
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1 && break
    sleep 1
  done
fi

echo ">>> Pulling model: $MODEL"
ollama pull "$MODEL"

echo ">>> Done. Double-click 'Local AI' on your desktop to start chatting."
