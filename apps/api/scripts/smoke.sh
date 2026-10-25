#!/usr/bin/env bash
# API smoke test against a throwaway local D1 database. Usage: pnpm smoke
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8788
API="http://127.0.0.1:$PORT"
STATE=.wrangler/smoke
WRANGLER=(pnpm exec wrangler)
OUT=$(mktemp)

rm -rf "$STATE"
"${WRANGLER[@]}" d1 migrations apply songbook --local --persist-to "$STATE" >/dev/null
"${WRANGLER[@]}" d1 execute songbook --local --persist-to "$STATE" --file test/fixture.sql >/dev/null

set -m # own process group, so the trap stops workerd too
"${WRANGLER[@]}" dev --port "$PORT" --persist-to "$STATE" >"$STATE.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || true; rm -f "$OUT"' EXIT
for _ in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 0.5; done

PASSED=0
FAILED=0
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then echo "PASS $1"; PASSED=$((PASSED + 1))
  else echo "FAIL $1: expected '$2', got '$3'"; FAILED=$((FAILED + 1)); fi
}
req() { # method path [token] [json]; sets STATUS and BODY
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json')
  [[ -n "${3:-}" ]] && args+=(-H "Authorization: Bearer $3")
  [[ -n "${4:-}" ]] && args+=(--data "$4")
  STATUS=$(curl "${args[@]}")
  BODY=$(cat "$OUT")
}
field() { jq -r "$1" <<<"$BODY"; }
login() { # email → token
  req POST /auth/magic/start "" "{\"email\":\"$1\"}"
  local code
  code=$(field .devCode)
  req POST /auth/magic/verify "" "{\"email\":\"$1\",\"code\":\"$code\"}"
  field .token
}
sync_all() { # walks /sync from $1 with limit=2; sets IDS, PAGES, CURSOR
  CURSOR=$1; IDS=(); PAGES=0
  while :; do
    req GET "/sync?limit=2&cursor=$CURSOR"
    PAGES=$((PAGES + 1))
    IDS+=($(field '.songs[].id'))
    CURSOR=$(field .cursor)
    [[ $(field .hasMore) == true && $PAGES -lt 20 ]] || break
  done
}
cp_json() { jq -Rs . <<<"$1"; } # ChordPro text → JSON string

echo "== sync pagination"
sync_all ""
check "5 unique songs" 5 "$(printf '%s\n' "${IDS[@]}" | sort -u | wc -l | tr -d ' ')"
check "3 pages of 2" 3 "$PAGES"

echo "== magic-link login"
req POST /auth/magic/start "" '{"email":"member@example.com"}'
check "start 200" 200 "$STATUS"
req POST /auth/magic/verify "" '{"email":"member@example.com","code":"000000x"}'
check "wrong code → 401" 401 "$STATUS"
MEMBER=$(login member@example.com)
ADMIN=$(login admin@example.com)
req GET /me "$MEMBER"
check "member role" member "$(field .user.role)"
req GET /me "$ADMIN"
check "admin role from ADMIN_EMAILS" admin "$(field .user.role)"
req GET /me
check "/me without token → 401" 401 "$STATUS"

echo "== member cannot edit"
req PUT /songs/fx-1 "$MEMBER" "{\"chordpro\":$(cp_json '{title: X}'),\"baseVersion\":1}"
check "member PUT → 403" 403 "$STATUS"
req POST /songs "$MEMBER" "{\"chordpro\":$(cp_json '{title: X}')}"
check "member POST → 403" 403 "$STATUS"
req DELETE /songs/fx-1 "$MEMBER"
check "member DELETE → 403" 403 "$STATUS"

echo "== proposals"
EDIT_CP=$(cp_json $'{title: Перша}\n{number: 1}\n{key: Am}\n[Am]Слава [F]Тобі, [C]Господи')
req POST /proposals "$MEMBER" "{\"kind\":\"edit\",\"songId\":\"fx-1\",\"baseVersion\":1,\"chordpro\":$EDIT_CP}"
check "edit proposal 201" 201 "$STATUS"
check "no conflict" false "$(field .conflict)"
EDIT_ID=$(field .proposal.id)
req POST /proposals "$MEMBER" "{\"kind\":\"new\",\"chordpro\":$(cp_json $'{title: Нова пісня}\n[D]Нова [G]пісня')}"
check "new proposal 201" 201 "$STATUS"
NEW_ID=$(field .proposal.id)
req GET /proposals/mine "$MEMBER"
check "mine lists both" 2 "$(field length)"
req GET /proposals "$MEMBER"
check "member cannot see queue" 403 "$STATUS"
req GET /proposals "$ADMIN"
check "queue has current version" 1 "$(field '.[] | select(.kind == "edit") | .current.version')"

req POST "/proposals/$EDIT_ID/approve" "$ADMIN" '{}'
check "approve edit 200" 200 "$STATUS"
check "song version bumped" 2 "$(field .song.version)"
req POST "/proposals/$EDIT_ID/approve" "$ADMIN" '{}'
check "approve again → 409" 409 "$STATUS"
req POST "/proposals/$NEW_ID/reject" "$ADMIN" '{"comment":"Вже є така пісня"}'
check "reject new 200" 200 "$STATUS"
check "reject comment" "Вже є така пісня" "$(field .proposal.reviewComment)"
req POST "/proposals/$NEW_ID/reject" "$ADMIN" '{}'
check "reject again → 409" 409 "$STATUS"
req POST "/proposals/$NEW_ID/approve" "$ADMIN" '{}'
check "approve rejected → 409" 409 "$STATUS"
req POST /proposals "$MEMBER" "{\"kind\":\"edit\",\"songId\":\"fx-1\",\"baseVersion\":1,\"chordpro\":$EDIT_CP}"
check "stale edit proposal flags conflict" true "$(field .conflict)"

echo "== version conflict"
req PUT /songs/fx-2 "$ADMIN" "{\"chordpro\":$(cp_json $'{title: Друга}\n{number: 2}\n[G]Нове'),\"baseVersion\":0}"
check "stale baseVersion → 409" 409 "$STATUS"
check "error code" version_conflict "$(field .error)"
req PUT /songs/fx-2 "$ADMIN" "{\"chordpro\":$(cp_json $'{title: Друга}\n{number: 2}\n[G]Нове'),\"baseVersion\":1}"
check "fresh baseVersion → 200" 200 "$STATUS"

echo "== song numbers"
req POST /songs "$ADMIN" "{\"chordpro\":$(cp_json $'{title: Дубль}\n{number: 1}\n[C]Текст')}"
check "duplicate number → 409" 409 "$STATUS"
check "error code" number_taken "$(field .error)"
req POST /songs "$ADMIN" "{\"chordpro\":$(cp_json $'{title: Без номера}\n[C]Текст')}"
check "create without number → 201" 201 "$STATUS"
check "next free number" 6 "$(field .number)"
check "number written into ChordPro" true "$(field '.chordpro | contains("{number: 6}")')"

echo "== tombstone"
sync_all ""
BEFORE=$CURSOR
req DELETE /songs/fx-3 "$ADMIN"
check "delete 200" 200 "$STATUS"
req GET "/sync?cursor=$BEFORE"
check "tombstone in delta" true "$(field '[.songs[] | select(.id == "fx-3" and .deletedAt != null)] | length == 1')"
req POST /songs "$ADMIN" "{\"chordpro\":$(cp_json $'{title: Нова третя}\n{number: 3}\n[C]Текст')}"
check "number of deleted song is free again" 201 "$STATUS"

echo "== shared albums"
MUSICIAN=$(login musician@example.com)
req GET /me "$MUSICIAN"
req PATCH "/users/$(field .user.id)" "$ADMIN" '{"role":"musician"}'
check "promote to musician" musician "$(field .role)"
req GET /albums
check "anonymous → 401" 401 "$STATUS"
req GET /albums "$MEMBER"
check "member list → 403" 403 "$STATUS"
req POST /albums "$MEMBER" '{"name":"X"}'
check "member create → 403" 403 "$STATUS"
req POST /albums "$MUSICIAN" '{"name":"  "}'
check "blank name → 400" 400 "$STATUS"
req POST /albums "$MUSICIAN" '{"name":"X","songIds":[1]}'
check "non-string song id → 400" 400 "$STATUS"
req POST /albums "$MUSICIAN" '{"name":" Неділя ","songIds":["fx-2","fx-1","fx-2"]}'
check "musician create 201" 201 "$STATUS"
check "name trimmed" "Неділя" "$(field .name)"
check "song ids deduplicated, order kept" "fx-2,fx-1" "$(field '.songIds | join(",")')"
ALBUM_ID=$(field .id)
req PUT "/albums/$ALBUM_ID" "$ADMIN" '{"name":"Неділя 10:00","songIds":["fx-1","fx-2","fx-4"]}'
check "admin update 200" 200 "$STATUS"
req GET /albums "$MUSICIAN"
check "list shows update" "Неділя 10:00|fx-1,fx-2,fx-4" "$(field '.[0] | .name + "|" + (.songIds | join(","))')"
req PUT /albums/missing "$MUSICIAN" '{"name":"X"}'
check "update missing → 404" 404 "$STATUS"
req DELETE "/albums/$ALBUM_ID" "$MEMBER"
check "member delete → 403" 403 "$STATUS"
req DELETE "/albums/$ALBUM_ID" "$MUSICIAN"
check "musician delete 200" 200 "$STATUS"
req GET /albums "$MUSICIAN"
check "list empty after delete" 0 "$(field length)"

echo
echo "$PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
