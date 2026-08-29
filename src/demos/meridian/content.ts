// src/demos/meridian/content.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND CATALOGUE — content, treated exactly like product (doc 18 §3).
//
// Each piece carries TWO ids: `systemId` is ours and stable; `customerContentId`
// is the customer's own CMS id — the id the delivery payload echoes back,
// because the whole contract is that the customer's front end paints content it
// already owns, addressed by an id it already knows. Tags are a map of registry
// dimension → the values the piece speaks to, in the SAME vocabulary the
// product catalogue scores against: one visitor vector, both catalogues.
//
// THE GUARD (same posture as reflexConfig's): a tag naming a dimension or a
// value outside the live registry vocabulary would score nothing and fail
// silently — the piece would simply never win, and it would look exactly like
// content personalization not working. So every piece is validated at module
// load, before anything renders, and the failure is loud and names the piece.
// ─────────────────────────────────────────────────────────────────────────────

import contentJson from './content.catalog.json';
import { itemsFor } from './catalog';
import { configFor, STAGE_LABELS } from './reflexConfig';
import type { ContentType, Vertical } from './types';

/** The four content surfaces of the page (§17): content hero, carousel, story, merch banner. */
export type ContentSlot = 'chero' | 'carousel' | 'story' | 'merch';

/** What kind of piece this is — the customer's editorial taxonomy, not ours. */
export type ContentPieceKind = 'editorial' | 'guide' | 'lookbook' | 'film' | 'campaign';

export interface ContentPiece {
  /** Ours, stable — the id the engine keys telemetry and snapshots by. */
  systemId: string;
  /** Theirs — the CMS id we echo back over the socket. The point of the contract. */
  customerContentId: string;
  vertical: Vertical;
  type: ContentPieceKind;
  title: string;
  /** One line under the title. Display only — never a dimension source. */
  subtitle: string;
  /** Registry dimension → values this piece speaks to. Scored, so validated. */
  tags: Readonly<Record<string, readonly string[]>>;
  /** Which slots may show it. Eligibility runs before scoring, as with blocks. */
  slotTypes: readonly ContentSlot[];
  lifecycle: { status: 'live' | 'draft' | 'expired' };
  /** Approved, committed artwork under /meridian/content/ — or null for a text-only piece. */
  art: string | null;
  /** Films only, e.g. "2:14". */
  runtime?: string;
}

const SLOTS: readonly ContentSlot[] = ['chero', 'carousel', 'story', 'merch'];
const KINDS: readonly ContentPieceKind[] = ['editorial', 'guide', 'lookbook', 'film', 'campaign'];

/** Runtime mirror of the ContentType union — the content dimension's vocabulary. */
const CONTENT_TYPES: readonly ContentType[] = [
  'on-model', 'silo', 'editorial', 'video', 'guide', 'calculator', 'rate-table', 'explainer',
];

/**
 * The live registry vocabulary for a vertical: dimension key → the values that
 * can actually be scored. Derived from the SAME sources the reflex reads —
 * band dimensions from their configured labels, the stage dimension from the
 * verb table, everything else from the catalogue items themselves — so this
 * can never drift from what the engine accepts.
 */
export function contentVocabFor(vertical: Vertical): Readonly<Record<string, ReadonlySet<string>>> {
  const items = itemsFor(vertical);
  const vocab: Record<string, Set<string>> = {};
  for (const spec of configFor(vertical).dimensions) {
    const values = new Set<string>();
    if (spec.derive === 'band') {
      for (const label of spec.labels ?? []) values.add(label);
    } else if (spec.source === '__verb__') {
      for (const label of Object.values(STAGE_LABELS[vertical])) values.add(label);
    } else if (spec.key === 'contentType') {
      for (const t of CONTENT_TYPES) values.add(t);
    } else {
      for (const item of items) {
        const raw = (item as unknown as Record<string, unknown>)[spec.source];
        if (Array.isArray(raw)) {
          for (const v of raw) if (typeof v === 'string') values.add(v);
        } else if (typeof raw === 'string') {
          values.add(raw);
        }
      }
    }
    vocab[spec.key] = values;
  }
  return vocab;
}

/** Loud, named validation of one piece. Exported so the suite can pin the guard itself. */
export function assertValidPiece(piece: ContentPiece, vocab: Readonly<Record<string, ReadonlySet<string>>>): void {
  const who = `content: piece "${piece.customerContentId}" (${piece.systemId})`;
  if (!KINDS.includes(piece.type)) {
    throw new Error(`${who} has unknown type "${piece.type}". Known: ${KINDS.join(', ')}.`);
  }
  if (piece.type === 'film' && !/^\d+:\d{2}$/.test(piece.runtime ?? '')) {
    throw new Error(`${who} is a film with no runtime. Films carry "m:ss".`);
  }
  if (!piece.slotTypes.length || piece.slotTypes.some((s) => !SLOTS.includes(s))) {
    throw new Error(`${who} names an unknown slot in [${piece.slotTypes.join(', ')}]. Known: ${SLOTS.join(', ')}.`);
  }
  for (const [dimKey, values] of Object.entries(piece.tags)) {
    const known = vocab[dimKey];
    if (!known) {
      throw new Error(
        `${who} tags dimension "${dimKey}", which is not in the ${piece.vertical} registry. `
        + `It would score nothing and fail silently. Known dimensions: ${Object.keys(vocab).join(', ')}.`,
      );
    }
    for (const v of values) {
      if (!known.has(v)) {
        throw new Error(
          `${who} tags ${dimKey}="${v}", which no ${piece.vertical} item, band or stage carries. `
          + `It would score nothing and fail silently. Known values: ${[...known].join(', ')}.`,
        );
      }
    }
  }
}

const ALL = Object.freeze(contentJson as unknown as ContentPiece[]);

// The guard runs at module load, before anything can render a piece.
{
  const seenCustomer = new Set<string>();
  const seenSystem = new Set<string>();
  const vocabs: Record<Vertical, Readonly<Record<string, ReadonlySet<string>>>> = {
    retail: contentVocabFor('retail'),
    financial: contentVocabFor('financial'),
  };
  for (const piece of ALL) {
    if (seenCustomer.has(piece.customerContentId) || seenSystem.has(piece.systemId)) {
      throw new Error(`content: duplicate id ${piece.customerContentId} / ${piece.systemId}.`);
    }
    seenCustomer.add(piece.customerContentId);
    seenSystem.add(piece.systemId);
    assertValidPiece(piece, vocabs[piece.vertical]);
  }
}

const BY_ID = new Map<string, ContentPiece>();
for (const p of ALL) {
  BY_ID.set(p.customerContentId, p);
  BY_ID.set(p.systemId, p);
}

export function contentFor(vertical: Vertical): readonly ContentPiece[] {
  return ALL.filter((p) => p.vertical === vertical && p.lifecycle.status === 'live');
}

/** Either id resolves — theirs or ours — because the wire carries both. */
export function contentById(id: string): ContentPiece | undefined {
  return BY_ID.get(id);
}
