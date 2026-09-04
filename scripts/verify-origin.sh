#!/usr/bin/env bash
# scripts/verify-origin.sh — is this origin connected to the platform? (integration kit, doc 04)
#
# Runs the requests a page on the origin would make, against a platform host, and prints PASS or
# FAIL per line. Run it from inside the customer's network and from ours; both prints go into the
# milestone record.
#
#   bash scripts/verify-origin.sh <platform base> <page origin> <site key> [tenant]
#   bash scripts/verify-origin.sh http://127.0.0.1:9100 http://localhost:9100 demo-site coach
set -u
BASE="${1:?platform base url}"; ORIGIN="${2:?page origin}"; KEY="${3:?site key}"; TENANT="${4:-coach}"
BASE="${BASE%/}"
V="vis-verify-$(date +%s)"
fails=0
pass() { printf '  PASS  %s%s\n' "$1" "${2:+  $2}"; }
fail() { printf '  FAIL  %s%s\n' "$1" "${2:+  $2}"; fails=$((fails+1)); }
code() { curl -s -m 20 -o "${OUT:-/dev/null}" -w '%{http_code}' "$@"; }

echo "origin $ORIGIN against $BASE, tenant $TENANT"

# 1. Health
C=$(code "$BASE/health"); [ "$C" = 200 ] && pass "health" "HTTP $C" || fail "health" "HTTP $C"

# 2. Cross-origin permission: the preflight a browser sends before a credentialed request
H=$(curl -s -m 20 -D - -o /dev/null -X OPTIONS -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,x-sdk-key" "$BASE/realtime/action")
ACAO=$(printf '%s' "$H" | tr -d '\r' | grep -i '^access-control-allow-origin:' | awk '{print $2}')
ACAC=$(printf '%s' "$H" | tr -d '\r' | grep -i '^access-control-allow-credentials:' | awk '{print $2}')
if [ "$ACAO" = "$ORIGIN" ] && [ "$ACAC" = "true" ]; then pass "cross-origin permission" "origin allowed, credentials permitted"; else fail "cross-origin permission" "allow-origin '${ACAO:-none}', credentials '${ACAC:-none}'"; fi

# 3. A decision, with the site key
OUT=/tmp/verify-snapshot.json C=$(code -H "Origin: $ORIGIN" -H "X-SDK-Key: $KEY" "$BASE/v1/$TENANT/decisions/snapshot?page=home&visitorId=$V")
N=$(python3 -c "import json; j=json.load(open('/tmp/verify-snapshot.json')); print(len(j.get('decisions',[])))" 2>/dev/null || echo 0)
[ "$C" = 200 ] && [ "$N" -gt 0 ] && pass "a decision" "HTTP $C, $N decisions" || fail "a decision" "HTTP $C, $N decisions"

# 4. The site key is enforced
C=$(code -H "Origin: $ORIGIN" "$BASE/v1/$TENANT/decisions/snapshot?page=home&visitorId=$V")
[ "$C" = 401 ] && pass "the site key is enforced" "no key answers HTTP $C" || fail "the site key is enforced" "no key answers HTTP $C (expected 401; open mode on a dev box answers 200)"

# 5. An event, from the origin, with the key
OUT=/tmp/verify-action.json C=$(code -X POST -H "Origin: $ORIGIN" -H "X-SDK-Key: $KEY" -H "Content-Type: application/json" -d "{\"type\":\"page_view\",\"userId\":\"$V\",\"data\":{\"path\":\"/\"},\"source\":\"verify-origin\",\"timestamp\":$(date +%s000)}" "$BASE/realtime/action")
S=$(python3 -c "import json; print(json.load(open('/tmp/verify-action.json')).get('success'))" 2>/dev/null || echo false)
[ "$C" = 200 ] && [ "$S" = True ] && pass "an event" "HTTP $C, success true" || fail "an event" "HTTP $C, success $S"

# 6. The live channel: the upgrade is accepted (101) with the key in the query
C=$(curl -s -m 10 -o /dev/null -w '%{http_code}' --http1.1 -H "Origin: $ORIGIN" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$BASE/realtime/ws?userId=$V&sdkKey=$KEY")
[ "$C" = 101 ] && pass "the live channel" "upgrade accepted" || fail "the live channel" "HTTP $C"

# 7. A wrong key is refused
C=$(code -H "Origin: $ORIGIN" -H "X-SDK-Key: not-a-key-for-this-site" "$BASE/v1/$TENANT/decisions/snapshot?page=home&visitorId=$V")
[ "$C" = 401 ] || [ "$C" = 403 ] && pass "a wrong key is refused" "HTTP $C" || fail "a wrong key is refused" "HTTP $C"

echo; [ $fails -eq 0 ] && echo "RESULT: PASS, the origin is connected" || echo "RESULT: $fails FAIL"
exit $fails
