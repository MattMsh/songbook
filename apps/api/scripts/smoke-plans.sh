#!/usr/bin/env bash
# Isolated API plan checks. Run: bash apps/api/scripts/smoke-plans.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8793
API="http://127.0.0.1:$PORT"
STATE=$(mktemp -d "${TMPDIR:-/tmp}/songbook-plans.XXXXXX")
OUT="$STATE/response.json"
pnpm exec wrangler d1 migrations apply songbook --local --persist-to "$STATE" >/dev/null
pnpm exec wrangler d1 execute songbook --local --persist-to "$STATE" --file test/fixture.sql >/dev/null
set -m
pnpm exec wrangler dev --port "$PORT" --persist-to "$STATE" >"$STATE/server.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || true; rm -rf "$STATE"' EXIT
for _ in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 0.5; done
req() {
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json')
  [[ -n "${3:-}" ]] && args+=(-H "Authorization: Bearer $3")
  [[ -n "${4:-}" ]] && args+=(--data "$4")
  STATUS=$(curl "${args[@]}")
}
check() {
  if [[ "$2" != "$3" ]]; then echo "FAIL $1: expected $2, got $3"; exit 1; fi
  echo "PASS $1"
}
field() { jq -r "$1" "$OUT"; }
login() {
  req POST /auth/magic/start "" "{\"email\":\"$1\"}"
  local code
  code=$(field .devCode)
  req POST /auth/magic/verify "" "{\"email\":\"$1\",\"code\":\"$code\"}"
  field .token
}
ADMIN=$(login admin@example.com)
MEMBER=$(login member@example.com)
req POST /albums "$MEMBER" '{"name":"Denied"}'
check 'member cannot create plans' 403 "$STATUS"
req POST /albums "" '{"name":"Denied"}'
check 'anonymous cannot create plans' 401 "$STATUS"
PLAN='{"name":"Sunday","songIds":["fx-1","fx-2"],"serviceDate":"2028-02-29","leader":"Олена","notes":"Вечір","songSettings":{"fx-1":{"transpose":-2,"capo":-1,"bpm":94,"notes":"Без паузи"}}}'
req POST /albums "$ADMIN" "$PLAN"
check 'create dated plan' 201 "$STATUS"
ID=$(field .id)
check 'negative capo offset retained' -1 "$(field '.songSettings["fx-1"].capo')"
req PUT "/albums/$ID" "$ADMIN" '{"name":"Renamed","songIds":["fx-2","fx-1"]}'
check 'legacy client reorder' 200 "$STATUS"
check 'reorder keeps date' 2028-02-29 "$(field .serviceDate)"
check 'reorder keeps settings' 94 "$(field '.songSettings["fx-1"].bpm')"
check 'reorder keeps order' fx-2 "$(field '.songIds[0]')"
req GET /albums "$ADMIN"
check 'list includes plan metadata' Олена "$(field "map(select(.id == \"$ID\"))[0].leader")"
for BAD in \
  '{"serviceDate":"2026-02-29"}' \
  '{"serviceDate":"2026-04-31"}' \
  '{"songIds":["missing"]}' \
  '{"songSettings":{"fx-3":{}}}' \
  '{"songSettings":{"fx-1":{"transpose":1.5}}}' \
  '{"songSettings":{"fx-1":{"capo":13}}}' \
  '{"songSettings":{"fx-1":{"bpm":401}}}' \
  '{"songSettings":{"fx-1":{"bpm":null}}}' \
  '{"songSettings":[]}' \
  '{"serviceDate":null}'
do
  BODY=$(jq -cn --argjson bad "$BAD" '{"name":"Invalid","songIds":["fx-1","fx-2"]} + $bad')
  req PUT "/albums/$ID" "$ADMIN" "$BODY"
  check "reject $BAD" 400 "$STATUS"
done
BODY=$(jq -cn '{"name":"Invalid","leader":("x" * 201)}')
req POST /albums "$ADMIN" "$BODY"
check 'leader limit' 400 "$STATUS"
BODY=$(jq -cn '{"name":"Invalid","notes":("x" * 10001)}')
req POST /albums "$ADMIN" "$BODY"
check 'notes limit' 400 "$STATUS"
req PUT "/albums/$ID" "$ADMIN" '{"name":"After invalid","songIds":["fx-2","fx-1"]}'
check 'invalid writes retained prior settings' 94 "$(field '.songSettings["fx-1"].bpm')"
req PUT "/albums/$ID" "$ADMIN" '{"name":"Cleared","songIds":["fx-2"],"serviceDate":"","leader":"","notes":""}'
check 'clear metadata' 200 "$STATUS"
check 'date cleared' null "$(field .serviceDate)"
check 'removed song settings pruned' 0 "$(field '.songSettings | length')"
req DELETE /songs/fx-2 "$ADMIN"
check 'delete referenced canonical song' 200 "$STATUS"
req PUT "/albums/$ID" "$ADMIN" '{"name":"Still editable","songIds":["fx-2"]}'
check 'retained tombstone does not block plan edits' 200 "$STATUS"
req POST /albums "$ADMIN" '{"name":"New invalid reference","songIds":["fx-2"]}'
check 'new albums cannot reference a tombstone' 400 "$STATUS"
req PUT "/albums/$ID" "$ADMIN" '{"name":"Removed tombstone","songIds":[]}'
check 'remove retained tombstone' 200 "$STATUS"
req PUT "/albums/$ID" "$ADMIN" '{"name":"Cannot re-add tombstone","songIds":["fx-2"]}'
check 'removed tombstone cannot be re-added' 400 "$STATUS"
req DELETE "/albums/$ID" "$ADMIN"
check 'delete plan' 200 "$STATUS"
echo 'Plan API smoke passed'
