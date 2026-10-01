# edge-personalization

The browser client of the personalization platform, as a package: it sends events, receives content
decisions for the slots on a page and carries the first-party shopper session. One file per format, no
dependencies. How to integrate is in the kit's integration guide (`docs/kit/01-integration-guide.md`);
the SDK's own reference is `src/sdk/README.md`.

## What is in the package

| File | Use |
|---|---|
| `edge-personalization.esm.js` | The ES module. `import { createClient } from 'edge-personalization'` resolves here |
| `edge-personalization.js` | The script-tag build (IIFE). It defines `window.EdgePersonalization`; `import 'edge-personalization/iife'` loads it for its global |
| `types/` | TypeScript declarations for both entries, generated from the SDK source |

```js
import { createClient } from 'edge-personalization';

const client = createClient({ tenant: '<tenant>', sdkKey: '<site key>' });
```

The same two bundles are served by every platform host at `/sdk/edge-personalization.js` and
`/sdk/edge-personalization.esm.js`, and under `/sdk/<version>/` for a page that pins a release.

## How it is built

Nothing here is edited by hand except `package.json`. `node scripts/build-sdk.mjs` writes the two bundles
and `types/` from `src/sdk`, and carries the version in `src/sdk/version.ts` into `package.json`;
`node scripts/build-sdk.mjs --check` rebuilds everything in memory and fails on the first difference.

`sizeBudget` in `package.json` is each exported bundle's size limit in bytes. The check fails when a
bundle is larger than its budget. The build never changes a budget: raising one is the owner's decision.

## Not published

The package is marked `private`, so `npm publish` refuses it. Which registry it goes to, under which
name or scope and under which licence, is decided with the release authority, not here.
