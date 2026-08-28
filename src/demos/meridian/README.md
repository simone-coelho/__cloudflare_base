# Meridian — isolation charter

The Opticon surface. **Everything this demo needs lives in this directory and in `public/meridian/`.** Nothing outside those two places may be modified to make this demo work, and nothing in here may be imported by another demo.

That rule exists because this surface will be presented by the CEO to thirty customers. It must be impossible for a change to Coach, Bright Hour, or the shared pipeline to break it — and equally impossible for this demo to break them.

---

## The one deliberate exception

**`src/reflex/core.ts` is imported, not copied.**

It is pure math: no state, no I/O, no config of its own — `effectiveScore`, `affinityOf`, `apply`, `tick`, `snapshot`, `nextCrossing`. Forking it would mean standing on stage demonstrating a *copy* of the engine rather than the engine. The honesty of the whole session rests on the arithmetic being the real arithmetic.

Everything stateful, everything wired, and everything configured is forked.

| | Decision |
|---|---|
| `src/reflex/core.ts` | **Import.** Pure, stateless, shared truth. |
| Everything else | **Fork.** Config, catalogs, composition, routes, storage, identity, ODP. |

---

## What isolation buys us, trap by trap

The audit of this repo found fourteen ways a new surface can silently corrupt an existing one. Being self-contained sidesteps most of them rather than mitigating them.

| Trap | How we avoid it |
|---|---|
| Unregistered surface resolves to `'coach'` silently | **We never enter the shared pipeline.** No `resolveSurface`, no registry entry, no default to fall through to. |
| Coach's `CatalogService` enriches every captured event | Own capture table. Own IDs on the `MRD-` prefix, which cannot collide with `COA-*` or `B\d{6}`. |
| `/operator/events/reset` deletes every demo's rows | Own table, own reset, scoped to this surface. |
| Audience-generator ping-pong archives the other catalog | Own audience namespace under `mrd:`. Our regeneration cannot see Coach's audiences and vice versa. |
| `listPublished()` N+1 KV amplification paid by all demos | Own store, own cache. We add zero reads to Coach's hot path. |
| Attribute keys are globally namespaced | Own store means our `category_affinity.*` never meets theirs. |
| Shared identity blends reflex vectors | `mrd_visitor_id`, `credentials: 'omit'`, never `opt_*`. |
| Origin-wide "New shopper" resets everything | Our reset clears only `mrd_*`. Coach's reset cannot touch us. |
| ODP forwards every surface to the Coach instance | Surface-scoped `MRD_ODP_*` credentials. Absent by default. |
| Coach decisions computed for every surface | We compose our own page and ignore the shared decision payload entirely. |
| `REFLEX_HOST` is a global switch | **See below — this is the important one.** |

---

## Why Meridian has its own Durable Object

The strongest beat in the session is the **unprompted exit**: the presenter stops touching the page, and roughly fifty seconds later it changes on its own, because a closed-form alarm fired and the visitor's affinity had decayed below the exit threshold.

That behaviour exists only on the Durable Object host. On the default session host, exit is scheduled by the *client* — so a stalled tab, or a presenter who switches windows, simply never exits.

But `REFLEX_HOST` is a single global var. Flipping it to `do` to get our beat would also move Coach onto a code path that has never run in production.

**So Meridian gets its own DO class, `MeridianReflex`, and always uses it.** No env switch, no shared toggle, nothing for anyone else to flip. We get the alarm-driven exit; Coach stays exactly where it is.

---

## Naming and namespaces

| | Value |
|---|---|
| Route | `/meridian` (page), `/meridian/api/*` (data) |
| Item IDs | `MRD-R###` retail · `MRD-F###` financial |
| Identity | `mrd_visitor_id`, `mrd_session_id` — localStorage, `credentials: 'omit'` |
| KV prefix | `mrd:` — audiences, config, profiles |
| Durable Object | `MeridianReflex`, keyed on `mrd_visitor_id` |
| ODP | `MRD_ODP_API_HOST` / `MRD_ODP_PUBLIC_KEY` — absent by default |
| D1 | own table, own reset scope |

---

## The two catalogs are structurally parallel — on purpose

Retail and financial declare **the same six dimension shapes** in different vocabulary:

| Shape | Meridian & Co. | Meridian Financial |
|---|---|---|
| broad | `category` | `productFamily` |
| narrow | `subcategory` | `subFamily` |
| value band | `priceBand` | `amountBand` |
| durable taste | `styleWorld` | `lifeStage` |
| multi-valued need | `occasion` | `intent` |
| content | `contentType` | `contentType` |

This is the whole vertical-swap argument made structural. When the catalog swaps on stage, **the same seven bars stay on screen and only their labels change.** The room does not have to take agnosticism on faith — they watch the instrument stay identical while the business underneath it changes.

Two speeds ship in both: the durable axes (`priceBand`, `styleWorld` / `amountBand`, `lifeStage`) visibly do not move while the fast axes spike. Same engine, same math, different τ.

---

## Rules for anyone working in here

1. Do not import from `src/demos/brighthour/` or from Coach code. Copy what you need.
2. Do not add `meridian` to `src/demos/registry.ts`. We are deliberately not in that pipeline.
3. Do not reuse `opt_*` storage keys, cookies, or KV prefixes.
4. Every visual beat must render from local state. **Never await the network to make something change on screen** — that is the one property that makes a demo survive venue wifi, and it is inherited deliberately from the original bank demo.
5. Any figure shown on stage is either real or labelled. There is no third option.
