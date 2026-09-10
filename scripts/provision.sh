#!/usr/bin/env bash
# Provision the snake operator account, the Snake workspace and its metric on
# one Telarchy store (docs/snake.md, "The workspace"). Idempotent enough to
# rerun: it stops when the workspace already exists for the operator.
#
#   BASE=https://telarchy.com/beta/api MASTER_KEY=... ./scripts/provision.sh
#
# Prints the env lines the service needs.
set -euo pipefail
BASE=${BASE:?}; MASTER_KEY=${MASTER_KEY:?}
OPERATOR_ID=${OPERATOR_ID:-snake-operator}
CREDITS=${CREDITS:-200000}
JOIN_WS=${JOIN_WS:-telarchy}   # a public workspace to register through

j() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "# registering $OPERATOR_ID via $JOIN_WS" >&2
REG=$(curl -sf -H 'Content-Type: application/json' -X POST "$BASE/agents/register" \
  -d "{\"agentId\":\"$OPERATOR_ID\",\"workspaceId\":\"$JOIN_WS\",\"nickname\":\"snake\",\"bio\":\"The operator of the futarchy snake. Posts four moves a minute, approves the one the market prices highest. Never trades.\"}" || true)
KEY=$(echo "$REG" | j "d.get('apiKey','')")
if [ -z "$KEY" ]; then echo "register failed or already registered: $REG" >&2; exit 1; fi

echo "# crediting $CREDITS" >&2
curl -sf -H "X-API-Key: $MASTER_KEY" -H "X-Workspace-Id: $JOIN_WS" -H 'Content-Type: application/json' \
  -X POST "$BASE/agents/$OPERATOR_ID/credit" -d "{\"amount\":$CREDITS,\"reason\":\"snake operator float (funds the pair books)\"}" >/dev/null

echo "# creating workspace Snake" >&2
WS=$(curl -sf -H "X-Agent-Key: $KEY" -H 'Content-Type: application/json' -X POST "$BASE/workspaces" \
  -d '{"name":"Snake","visibility":"public"}')
WSID=$(echo "$WS" | j "d['id']"); SLUG=$(echo "$WS" | j "d['slug']")

echo "# creating metric Snake length" >&2
METRIC=$(curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WSID" -H 'Content-Type: application/json' -X POST "$BASE/metrics" -d '{
  "name": "Snake length",
  "description": "How many segments the snake has right now. A step every minute; the market picks the direction. Death respawns it at 3.",
  "value": 3,
  "marketRangeMax": 60,
  "timePreference": { "enabled": false, "customHorizons": ["+0d", "+0w"],
    "horizonCredits": { "+0d": { "book": 25, "proposal": 20 }, "+0w": { "book": 25, "proposal": 5 } } }
}')
MID=$(echo "$METRIC" | j "d['id']")

echo "# settings: one-minute decision window, public" >&2
curl -sf -H "X-Agent-Key: $KEY" -H "X-Workspace-Id: $WSID" -H 'Content-Type: application/json' -X PUT "$BASE/workspaces/$WSID/settings" -d '{
  "decisionMinutes": 1, "visibility": "public", "notificationsMuted": true,
  "description": "A snake game steered by this market: four proposals a minute, one per direction, the highest approved.",
  "subjectAbout": "Every minute four proposals appear, Move up / right / down / left. Each is priced on the snake length at the end of today (and this week). At second 55 the operator approves the move the market prices highest and declines the rest with a refund. The snake moves at the top of the next minute. Watch it live on the board (link in the workspace description) and trade the move you believe in."
}' >/dev/null

echo "# opening the today/week books" >&2
curl -sf -H "X-API-Key: $MASTER_KEY" -H 'Content-Type: application/json' -X POST "$BASE/cron/refresh" -d "{\"workspaceId\":\"$WSID\"}" >/dev/null || echo "refresh call failed (the hourly cron will open them)" >&2

cat <<ENV
TELARCHY_BASE_URL=$BASE
TELARCHY_API_KEY=$KEY
TELARCHY_WORKSPACE_ID=$WSID
TELARCHY_METRIC_ID=$MID
WORKSPACE_URL=${BASE%/api}/$SLUG
ENV
