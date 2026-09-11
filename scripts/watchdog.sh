#!/usr/bin/env bash
# Keep the snake playable without a human (docs/snake.md, "Operation").
# Runs on the snake's host every minute: when the health check says the game
# has stalled, restart the operator; when the stream is down, start it. Every
# action is logged with its reason, and nothing is restarted twice in five
# minutes, so a real outage is visible instead of hidden by a restart loop.
set -uo pipefail
LOG=${LOG:-$HOME/logs/telarchy-snake-watchdog.log}
LAST=${LAST:-$HOME/state/watchdog-last-restart}
COOLDOWN=${COOLDOWN:-300}
cd "$(dirname "$0")/.." || exit 1
say() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

mkdir -p "$(dirname "$LOG")"
# Trim, so a night of heartbeats never fills the disk.
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 5000 ] && tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

OUT=$(./scripts/health.sh 2>&1); RC=$?
if [ $RC -eq 0 ]; then
  # A heartbeat, so silence means "not running" rather than "all well".
  say "$OUT" 
  systemctl --user is-active --quiet telarchy-snake-stream.service || {
    say "stream is down, starting it"; systemctl --user start telarchy-snake-stream.service; }
  exit 0
fi
say "unhealthy: $OUT"

NOW=$(date +%s); PREV=$(cat "$LAST" 2>/dev/null || echo 0)
if [ $((NOW - PREV)) -lt "$COOLDOWN" ]; then say "not restarting: last restart $((NOW - PREV))s ago"; exit 1; fi

case "$OUT" in
  *"has not moved"*|*"feed unreachable"*|*"feed returned nothing"*|*"no open proposal"*|*"option books"*|*"not the shape"*)
    mkdir -p "$(dirname "$LAST")"; echo "$NOW" > "$LAST"
    say "restarting the operator"
    systemctl --user restart telarchy-snake.service
    sleep 20
    systemctl --user is-active --quiet telarchy-snake-stream.service || systemctl --user start telarchy-snake-stream.service
    say "after restart: $(./scripts/health.sh 2>&1)"
    ;;
  *"floor"*)
    say "the floor is at fault, not the snake: nothing to restart here" ;;
  *) say "no rule for this failure; left alone" ;;
esac
