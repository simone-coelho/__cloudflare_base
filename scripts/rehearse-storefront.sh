#!/usr/bin/env bash
# scripts/rehearse-storefront.sh — the storefront cutover rehearsal (plan 21, the CW8 seam's follow-up).
#
# Drives the demo storefront through the same beats in both transports, the page's own copy
# (default) and the SDK (?sdk=1), in a real headless browser through /__shot, and compares what
# the page is doing: identity, the socket, the events sent, the affinity that built, the hero,
# and in SDK mode the content decisions and their ledger records. Scripted and repeatable, which
# is the same bar the acceptance run has to meet.
#
#   bash scripts/rehearse-storefront.sh [BASE]        BASE defaults to http://127.0.0.1:9100
#
# Needs SHOT_TOKEN in .dev.vars (the /__shot route is closed without it) and the JWT vars in
# wrangler.toml for the ledger check. Prints PASS/FAIL per check and exits non-zero on a FAIL.
set -u
BASE="${1:-http://127.0.0.1:9100}"
TOKEN=$(grep -E '^SHOT_TOKEN=' .dev.vars 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
if [ -z "$TOKEN" ]; then echo "SHOT_TOKEN not in .dev.vars; the rehearsal needs the screenshot route"; exit 2; fi
JWT=$(node --input-type=module -e "
import { readFileSync } from 'node:fs'; import * as jose from 'jose';
const t=readFileSync('wrangler.toml','utf8'); const v=(k)=>(t.match(new RegExp('^'+k+' = \"([^\"]+)\"','m'))||[])[1];
console.log(await new jose.SignJWT({sub:'rehearsal'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setIssuer(v('JWT_ISSUER')).setAudience(v('JWT_AUDIENCE')).setExpirationTime('10m').sign(new TextEncoder().encode(v('JWT_SECRET'))));" 2>/dev/null || true)

# The beats: load the store, open the first product (product_view), add it to the bag (add_to_cart).
CLICKS='.tile,#pdp-add'
PROBE='window.__sfProbe ? JSON.stringify(window.__sfProbe()) : "{\"error\":\"no probe\"}"'
declare -A R
for MODE in copy sdk; do
  PATHQ="/storefront"; [ "$MODE" = sdk ] && PATHQ="/storefront?sdk=1"
  OUT=$(curl -s -m 120 -G "$BASE/__shot" --data-urlencode "token=$TOKEN" --data-urlencode "path=$PATHQ" --data-urlencode "w=1440" --data-urlencode "h=1600" --data-urlencode "wait=2500" --data-urlencode "clicks=$CLICKS" --data-urlencode "probe=$PROBE")
  R[$MODE]="$OUT"
done

python3 - "$BASE" "$JWT" "${R[copy]}" "${R[sdk]}" <<'PY'
import json, sys, urllib.request
base, jwt, copy_raw, sdk_raw = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def parse(raw):
    try: j = json.loads(raw)
    except Exception: return None, {'error': raw[:200]}
    r = j.get('result')
    if isinstance(r, str):
        try: r = json.loads(r)
        except Exception: r = {'error': r[:200]}
    return j, r or {}
cj, c = parse(copy_raw); sj, s = parse(sdk_raw)
fails = 0
def check(name, ok, detail=''):
    global fails
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")
    if not ok: fails += 1
for label, j, p in (('copy', cj, c), ('sdk', sj, s)):
    print(f"\n{label}: clicks {j.get('clicks') if j else 'n/a'}")
    if 'error' in p: print('  probe error:', p['error'])
    check('mode is what was asked', p.get('mode') == label, str(p.get('mode')))
    check('visitor id minted and stored, same value both places', isinstance(p.get('visitorId'), str) and p.get('visitorId', '').startswith('vis-') and p.get('visitorId') == p.get('storedVisitorId'), str(p.get('visitorId')))
    check('socket connected', p.get('ws') == 'connected', str(p.get('ws')))
    check('two events sent (product view, add to bag)', (p.get('events') or 0) >= 2, f"events {p.get('events')}")
    check('affinity built from the events', len(p.get('affinityDims') or []) >= 1, str(p.get('affinityDims')))
    check('hero painted', bool(p.get('heroTitle')), repr(p.get('heroTitle'))[:60])
    if label == 'sdk':
        check('SDK loaded', bool(p.get('sdkVersion')), str(p.get('sdkVersion')))
        eh, es = p.get('engineHero'), p.get('engineStory')
        check("the hero on the page is the engine's decision", bool(eh and eh.get('title') and eh.get('title') == p.get('heroTitle')), f"{(eh or {}).get('customerContentId')} {(eh or {}).get('strategy')} top={(eh or {}).get('top')}")
        check("the story on the page is the engine's decision", bool(es and es.get('title') and es.get('title') == p.get('storyTitle')), f"{(es or {}).get('customerContentId')} {repr(p.get('storyTitle'))[:50]}")
        if p.get('dominantLine'):
            check("the hero follows the line she circles", p['dominantLine'] in ((eh or {}).get('line') or []), f"line {p['dominantLine']} in {(eh or {}).get('line')}")
        d = p.get('decisions')
        check('content decisions hydrated for the page', isinstance(d, list) and len(d) >= 1, str([(x['slot'], x['item']) for x in d])[:120] if isinstance(d, list) else str(d))
        if isinstance(d, list) and d and jwt and p.get('decisionTs') and p.get('visitorId'):
            # the id is deterministic: tenant, the set's time in base 36, the visitor, the page, the slot, position 0
            slot = sorted(x['slot'] for x in d)[0]
            def b36(n):
                digits = '0123456789abcdefghijklmnopqrstuvwxyz'; out = ''
                while n > 0: out = digits[n % 36] + out; n //= 36
                return out or '0'
            did = f"coach:{b36(int(p['decisionTs']))}:{p['visitorId']}:home:{slot}:0"
            hit = None
            for _ in range(6):
                try:
                    req = urllib.request.Request(f"{base}/v1/coach/ledger/{did}", headers={'Authorization': 'Bearer ' + jwt})
                    with urllib.request.urlopen(req, timeout=15) as r: hit = json.load(r); break
                except Exception: import time; time.sleep(5)
            check('the first decision is in the ledger', bool(hit and hit.get('ok')), f"{did}")
same = [k for k in ('ws', 'events') if c.get(k) == s.get(k)]
print(f"\nboth transports agree on: {same}; affinity dims copy {c.get('affinityDims')} vs sdk {s.get('affinityDims')}")
print(f"hero: page rules said {c.get('heroTitle')!r}; the engine said {s.get('heroTitle')!r} (by design these differ: one is written into the page, the other is decided)")
print('\nRESULT:', 'PASS' if fails == 0 else f'{fails} FAIL')
sys.exit(1 if fails else 0)
PY
