#!/usr/bin/env bash
# Install or refresh the snake on its server (docs/snake.md, "Operation"). Run as telarchy: bash deploy/install.sh
# Idempotent. Expects ~/src/telarchy-snake to be this checkout with a filled .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "write .env first (see .env.example)"; exit 1; }
npm ci --silent
npm run build --silent
mkdir -p ~/.config/systemd/user ~/logs state
cp deploy/telarchy-snake.service deploy/telarchy-snake-stream.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now telarchy-snake.service
systemctl --user restart telarchy-snake.service
if grep -q '^TWITCH_STREAM_KEY=.\+' .env; then
  systemctl --user enable --now telarchy-snake-stream.service
  systemctl --user restart telarchy-snake-stream.service
else
  echo "no TWITCH_STREAM_KEY in .env: stream unit not started"
fi
systemctl --user --no-pager --no-legend list-units 'telarchy-snake*'
