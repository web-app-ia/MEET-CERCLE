#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test de l'orchestrateur MEET-CERCLE (à lancer après `wrangler deploy`)
# Usage : BASE_URL=https://meet-cercle-worker.<compte>.workers.dev ./scripts/smoke-test.sh
# ---------------------------------------------------------------------------
set -euo pipefail

BASE="${BASE_URL:-http://127.0.0.1:8787}"

echo "→ /api/health"
curl -fsS "$BASE/api/health" | tee /dev/stderr | grep -q '"ok":true'

echo "→ /api/config (serveurs ICE)"
curl -fsS "$BASE/api/config"

echo ""
echo "→ POST /api/rooms (création)"
ROOM=$(curl -fsS -X POST "$BASE/api/rooms" -H 'Content-Type: application/json' -d '{}' | sed -n 's/.*"room":"\([^"]*\)".*/\1/p')
echo "  salon = $ROOM"

echo "→ POST /api/rooms/$ROOM/join (alice)"
curl -fsS -X POST "$BASE/api/rooms/$ROOM/join" -H 'Content-Type: application/json' -d '{"identity":"alice"}'

echo ""
echo "→ POST /api/rooms/$ROOM/join (bob)"
curl -fsS -X POST "$BASE/api/rooms/$ROOM/join" -H 'Content-Type: application/json' -d '{"identity":"bob"}'

echo ""
echo "→ GET /api/rooms/$ROOM (état)"
curl -fsS "$BASE/api/rooms/$ROOM"

echo ""
echo "→ POST /api/rooms/$ROOM/leave ×2"
curl -fsS -X POST "$BASE/api/rooms/$ROOM/leave" -H 'Content-Type: application/json' -d '{"pid":"x"}' >/dev/null || true

echo ""
echo "OK — la signalisation WebSocket et la bascule SFU se testent dans un navigateur"
echo "     (ouvrir $BASE/ dans ≥5 onglets pour déclencher le provisionnement)."
