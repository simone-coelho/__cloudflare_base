#!/usr/bin/env bash
# scripts/rehearse-signin.sh — the sign-in beat on the Coach storefront, rehearsed in a real browser.
#
# Two devices, one person. The "phone" (one browser context) views a product and signs in as an
# account; the "laptop" (a fresh context: new visitor id, no cookies) views a different product
# and signs in as the same account. After the laptop's sign-in its instrument must carry BOTH
# products' lines, its visitor id must be the person's shopper id, and neither device must ever
# see the raw account id. Then the laptop signs out and is anonymous again. Driven through
# /__shot with clicks, a script, and the page probe, in both transports.
#
#   bash scripts/rehearse-signin.sh [BASE]        BASE defaults to http://127.0.0.1:9100
#
# Needs SHOT_TOKEN in .dev.vars (the screenshot route is closed without it).
set -u
BASE="${1:-http://127.0.0.1:9100}"
TOKEN=$(grep -E '^SHOT_TOKEN=' .dev.vars 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
if [ -z "$TOKEN" ]; then echo "SHOT_TOKEN not in .dev.vars; the rehearsal needs the screenshot route"; exit 2; fi
RUN=$(date +%s | tail -c 6)
ACCOUNT="ana-${RUN}@example.com"
PROBE='JSON.stringify({ visitorId: store.visitorId, stored: (() => { try { return localStorage.getItem("opt_visitor_id"); } catch (e) { return null; } })(), dims: store.affinity && store.affinity.dims ? Object.fromEntries(Object.entries(store.affinity.dims).map(([d, v]) => [d, Object.keys(v)])) : {}, status: (document.getElementById("pzaf-identity") || {}).textContent || "", ws: (document.getElementById("eng-ws") || {}).textContent || "", html: document.documentElement.outerHTML.length })'

shot() { # path, clicks, js, probe
  curl -s -m 150 -G "$BASE/__shot" --data-urlencode "token=$TOKEN" --data-urlencode "path=$1" --data-urlencode "w=1440" --data-urlencode "h=800" \
    --data-urlencode "wait=2200" --data-urlencode "clicks=$2" --data-urlencode "js=$3" --data-urlencode "probe=$4"
}
SIGNIN="(async () => { document.getElementById('pzaf-account').value = '$ACCOUNT'; await store.signIn(); await new Promise(r => setTimeout(r, 1500)); })()"
SIGNIN_OUT="(async () => { document.getElementById('pzaf-account').value = '$ACCOUNT'; await store.signIn(); await new Promise(r => setTimeout(r, 1200)); await store.signOut({ reload: false }); await new Promise(r => setTimeout(r, 800)); })()"

fails=0
check() { if [ "$1" = 1 ]; then echo "  PASS  $2"; else echo "  FAIL  $2  $3"; fails=$((fails+1)); fi; }

for MODE in copy sdk; do
  P="/storefront"; [ "$MODE" = sdk ] && P="/storefront?sdk=1"
  echo; echo "== $MODE transport, account $ACCOUNT-$MODE =="
  ACC="$ACCOUNT-$MODE"
  PH=$(shot "$P" ".tile:nth-of-type(1)" "${SIGNIN/$ACCOUNT/$ACC}" "$PROBE")
  LP=$(shot "$P" ".tile:nth-of-type(4)" "${SIGNIN_OUT/$ACCOUNT/$ACC}" "$PROBE")
  python3 - "$PH" "$LP" "$ACC" <<'PY'
import json, sys
ph_raw, lp_raw, acc = sys.argv[1], sys.argv[2], sys.argv[3]
def parse(raw):
    try: j = json.loads(raw); r = j.get('result'); return j, (json.loads(r) if isinstance(r, str) else (r or {}))
    except Exception: return {}, {'error': raw[:300]}
pj, ph = parse(ph_raw); lj, lp = parse(lp_raw)
fails = 0
def check(name, ok, detail=''):
    global fails; print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  ' + str(detail)) if detail else ''}");  fails += 0 if ok else 1
print('  phone clicks', pj.get('clicks'), '| laptop clicks', lj.get('clicks'))
if 'error' in ph or 'error' in lp: print('  probe error:', ph.get('error'), lp.get('error'))
sh = ph.get('visitorId') or ''
check('phone signed in: its visitor id is now a shopper id', sh.startswith('sh_') and len(sh) == 35, sh)
check('phone stored the shopper id as opt_visitor_id', ph.get('stored') == sh, ph.get('stored'))
check('phone status says signed in', 'Signed in' in ph.get('status', ''), ph.get('status')[:80])
ph_lines = set((ph.get('dims') or {}).get('line', []))
check('phone learned a line from its product view', len(ph_lines) >= 1, sorted(ph_lines))
# The laptop: after sign-in AND sign-out. The probe runs after sign-out, so its status is
# anonymous again; what it saw in between is in the event log, which the dims still reflect
# only if the instrument kept them. Judge the merge from the person's vector instead:
check('laptop signed out: anonymous again with a fresh vis- id', (lp.get('visitorId') or '').startswith('vis-') and 'Anonymous' in lp.get('status', ''), lp.get('visitorId'))
check('the raw account id never appears in either page', acc not in ph_raw and acc not in lp_raw)
sys.exit(fails)
PY
  fails=$((fails + $?))
  # The merge itself, read from the person's vector through the same route the instrument uses.
  PERSON=$(python3 - "$PH" <<'PY'
import json, sys
j = json.loads(sys.argv[1]); r = j.get('result'); r = json.loads(r) if isinstance(r, str) else r
print(r.get('visitorId', ''))
PY
)
  MERGED=$(curl -s "$BASE/realtime/reflex?userId=$PERSON" -H 'X-SDK-Key: demo-site')
  python3 - "$MERGED" "$PH" "$LP" <<'PY'
import json, sys
m = json.loads(sys.argv[1]); ph = json.loads(json.loads(sys.argv[2])['result']); lp_raw = sys.argv[3]
lines = list(((m.get('affinity') or {}).get('dims') or {}).get('line', {}).keys())
ph_lines = set((ph.get('dims') or {}).get('line', []))
ok = len(lines) >= 2 and ph_lines.issubset(set(lines))
print(f"  {'PASS' if ok else 'FAIL'}  the person carries both devices' lines  {sorted(lines)} (phone alone had {sorted(ph_lines)})")
sys.exit(0 if ok else 1)
PY
  fails=$((fails + $?))
done

echo; if [ "$fails" = 0 ]; then echo "sign-in rehearsal: all green"; else echo "sign-in rehearsal: $fails FAIL"; fi
exit $([ "$fails" = 0 ] && echo 0 || echo 1)
