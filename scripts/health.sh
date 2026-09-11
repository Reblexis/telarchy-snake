#!/usr/bin/env bash
# Is the snake actually playable right now? One line per check, non-zero exit
# on the first failure (docs/snake.md, "Operation"). Safe to run anywhere.
set -uo pipefail
FEED=${FEED:-https://snake.telarchy.com}
FLOOR=${FLOOR:-https://telarchy.com}
STATE_CACHE=${STATE_CACHE:-/tmp/snake-health-step}
fail() { echo "FAIL: $*"; exit 1; }

S=$(curl -s --max-time 10 "$FEED/state") || fail "feed unreachable"
[ -n "$S" ] || fail "feed returned nothing"
read -r STEP PHASE COMPLETE LEN OPENID < <(printf '%s' "$S" | python3 -c "
import sys,json
d=json.load(sys.stdin); o=d.get('open') or {}
print(d['game']['step'], d.get('phase'), d.get('complete'), d['game']['length'], (o.get('proposal') or {}).get('id','-'))
") || fail "feed is not the shape the board reads"

# The step must move: one a minute, so two minutes without one is a stall.
PREV=$(cat "$STATE_CACHE" 2>/dev/null | cut -d' ' -f1)
PREVAT=$(cat "$STATE_CACHE" 2>/dev/null | cut -d' ' -f2)
NOW=$(date +%s)
if [ -n "${PREV:-}" ] && [ "$PREV" = "$STEP" ] && [ -n "${PREVAT:-}" ] && [ $((NOW - PREVAT)) -gt 150 ]; then
  echo "$STEP $PREVAT" > "$STATE_CACHE"
  fail "step $STEP has not moved in $((NOW - PREVAT))s"
fi
[ "${PREV:-}" = "$STEP" ] || echo "$STEP $NOW" > "$STATE_CACHE"

# A playable step: a proposal to trade, unless the game is between games.
# Retried once: the operator posts the step's proposal at :00, and for a
# second or two either the feed or the floor payload can be a beat behind.
if [ "$COMPLETE" != "True" ] && { [ "$OPENID" = "-" ] || [ "$OPENID" = "None" ]; }; then
  sleep 6
  OPENID=$(curl -s --max-time 10 "$FEED/state" | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print('-'); raise SystemExit
print(((d.get('open') or {}).get('proposal') or {}).get('id','-'))
")
  [ "$OPENID" != "-" ] && [ "$OPENID" != "None" ] || fail "no open proposal on the feed (phase $PHASE)"
fi

# The floor reads the same game through its own proxy, and the page serves.
L=$(curl -s --max-time 10 "$FLOOR/api/marketplace/snake/live") || fail "floor proxy unreachable"
LSTEP=$(printf '%s' "$L" | python3 -c "import sys,json;print(json.load(sys.stdin)['game']['step'])" 2>/dev/null) || fail "floor proxy is not serving the feed"
[ $((STEP - LSTEP)) -le 3 ] && [ $((LSTEP - STEP)) -le 3 ] || fail "floor proxy is $((STEP - LSTEP)) steps behind"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$FLOOR/snake") || fail "floor page unreachable"
[ "$CODE" = 200 ] || fail "floor page returned $CODE"

# Something to trade on: the open proposal carries its three option books.
OPTS=$(curl -s --max-time 10 "$FLOOR/api/marketplace/snake" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ps=[p for p in d.get('proposals',[]) if not p.get('closedAt') and not p.get('resolvedAt')]
if not ps: print(0); raise SystemExit
m=(ps[0].get('markets') or [{}])[0]
print(len(m.get('options') or []))
" 2>/dev/null) || fail "floor payload unreadable"
if [ "$COMPLETE" != "True" ] && [ "${OPTS:-0}" -lt 3 ]; then
  # Same beat: the proposal is created before its option books are, and the
  # floor payload is cached for a moment. Ask once more before calling it.
  sleep 8
  OPTS=$(curl -s --max-time 10 "$FLOOR/api/marketplace/snake" | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print(0); raise SystemExit
ps=[p for p in d.get('proposals',[]) if not p.get('closedAt') and not p.get('resolvedAt')]
if not ps: print(0); raise SystemExit
m=(ps[0].get('markets') or [{}])[0]
print(len(m.get('options') or []))
" 2>/dev/null)
  [ "${OPTS:-0}" -ge 3 ] || fail "the open proposal has $OPTS option books, not three"
fi

echo "OK step $STEP phase $PHASE length $LEN options $OPTS"
