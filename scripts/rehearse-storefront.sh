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

# The learning loop, end to end: a fresh visitor is served a hero, clicks its button, and after the
# statistics object's publish (30 s) the served piece's row carries the success. Slow, so it is the
# last thing the rehearsal does; skip it with QUICK=1.
CREDIT=""
if [ -z "${QUICK:-}" ]; then
  BEFORE=$(curl -s -m 15 -H "X-SDK-Key: demo-site" "$BASE/v1/coach/lift?slot=chero" | python3 -c "import sys,json; s=(json.load(sys.stdin).get('snapshot') or {}); print(json.dumps({k:(v.get('*') or {}).get('s',0) for k,v in s.get('items',{}).items()}))")
  # Start, then Next three times (the store is on the home view at step 4 with the hero and its button
  # showing); then the hero's button, pressed through the page's own handler after a check that it is
  # really on screen, so a transition mid-frame cannot fail the press.
  CLICK=$(curl -s -m 300 -G "$BASE/__shot" --data-urlencode "token=$TOKEN" --data-urlencode "path=/storefront?sdk=1" --data-urlencode "wait=3000" --data-urlencode "clicks=#dir-next,#dir-next,#dir-next,#dir-next" --data-urlencode "js=(()=>{const el=document.querySelector('#hero-content .hero-cta');const r=el?el.getBoundingClientRect():null;const cs=el?getComputedStyle(el):null;window.__cta={present:!!el,visible:!!(el&&r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'),text:el?el.textContent.trim():null,view:['home','plp','pdp'].find(v=>document.getElementById('view-'+v).classList.contains('active'))};if(el)el.click();})()" --data-urlencode "hold=38000" --data-urlencode "probe=JSON.stringify({served: store._engineHero && store._engineHero.contentId, cid: store._engineHero && store._engineHero.customerContentId, cta: window.__cta||null})")
  AFTER=$(curl -s -m 15 -H "X-SDK-Key: demo-site" "$BASE/v1/coach/lift?slot=chero" | python3 -c "import sys,json; s=(json.load(sys.stdin).get('snapshot') or {}); print(json.dumps({k:(v.get('*') or {}).get('s',0) for k,v in s.get('items',{}).items()}))")
  CREDIT=$(python3 -c "
import json,sys
before, click, after = json.loads(sys.argv[1]), json.loads(sys.argv[2]), json.loads(sys.argv[3])
r = click.get('result'); r = json.loads(r) if isinstance(r, str) else (r or {})
served = r.get('served'); gained = (after.get(served, 0) - before.get(served, 0)) if served else 0
print(json.dumps({'served': served, 'cid': r.get('cid'), 'clicks': click.get('clicks'), 'cta': r.get('cta'), 'gained': round(gained, 3)}))" "$BEFORE" "$CLICK" "$AFTER")
fi

python3 - "$BASE" "$JWT" "${R[copy]}" "${R[sdk]}" "$CREDIT" <<'PY'
import json, sys, urllib.request
base, jwt, copy_raw, sdk_raw, credit_raw = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else ''
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
if credit_raw:
    cr = json.loads(credit_raw)
    cta = cr.get('cta') or {}
    print(f"\nthe loop: served {cr.get('cid')} ({cr.get('served')}); beats {cr.get('clicks')}; button {cta}")
    check("the hero's button was on screen when pressed", bool(cta.get('visible')), f"view {cta.get('view')}, text {cta.get('text')!r}")
    check("the click on the served hero became a success on its lift row", (cr.get('gained') or 0) > 0, f"s gained {cr.get('gained')} after the publish")
same = [k for k in ('ws', 'events') if c.get(k) == s.get(k)]
print(f"\nboth transports agree on: {same}; affinity dims copy {c.get('affinityDims')} vs sdk {s.get('affinityDims')}")
print(f"hero: page rules said {c.get('heroTitle')!r}; the engine said {s.get('heroTitle')!r} (by design these differ: one is written into the page, the other is decided)")
print('\nRESULT:', 'PASS' if fails == 0 else f'{fails} FAIL')
sys.exit(1 if fails else 0)
PY
