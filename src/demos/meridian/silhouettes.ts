// src/demos/meridian/silhouettes.ts
// ─────────────────────────────────────────────────────────────────────────────
// One monoline silhouette per category, drawn at 0 0 100 100.
//
// These are not decoration and they are not a fallback we hope never fires.
// They are the card's IDENTITY LAYER: together with the item's own hue they
// make every tile distinguishable at projector distance, which is the whole
// reason a re-rank is legible. A photograph layers OVER this when one exists.
//
// Bright Hour's rule, inherited: the placeholder is never replaced, it is
// underneath. A missing image degrades by removing the <img> and revealing what
// was already painted — no empty frame, no flash, no second layout pass.
// ─────────────────────────────────────────────────────────────────────────────

/** SVG inner markup, stroke-driven so it inherits `stroke` from the caller. */
export const SILHOUETTE: Record<string, string> = {
  Bags:
    '<path d="M35 40 Q35 23 50 23 Q65 23 65 40"/>' +
    '<path d="M23 40 L77 40 L72 79 L28 79 Z"/>',
  Outerwear:
    '<path d="M31 28 L69 28 L73 80 L27 80 Z"/>' +
    '<path d="M42 28 L50 41 L58 28"/>' +
    '<path d="M31 28 L20 63"/><path d="M69 28 L80 63"/>',
  Knitwear:
    '<path d="M33 33 L67 33 L69 72 L31 72 Z"/>' +
    '<path d="M42 33 Q50 41 58 33"/>' +
    '<path d="M33 33 L21 58 L29 63"/><path d="M67 33 L79 58 L71 63"/>',
  Footwear:
    '<path d="M34 24 L48 24 L50 57 Q70 61 74 70 L74 79 L30 79 L30 34 Z"/>' +
    '<path d="M30 68 L74 68"/>',
  Jewellery:
    '<circle cx="50" cy="57" r="23"/>' +
    '<path d="M43 30 L50 18 L57 30 Z"/>',
  Fragrance:
    '<path d="M44 18 L56 18 L56 28 L44 28 Z"/>' +
    '<path d="M47 28 L53 28 L53 34 L47 34"/>' +
    '<path d="M38 34 L62 34 Q66 34 66 40 L66 76 Q66 80 62 80 L38 80 Q34 80 34 76 L34 40 Q34 34 38 34 Z"/>',
  Eyewear:
    '<circle cx="33" cy="53" r="14"/><circle cx="67" cy="53" r="14"/>' +
    '<path d="M47 51 Q50 46 53 51"/>' +
    '<path d="M19 48 L13 43"/><path d="M81 48 L87 43"/>',
  Scarves:
    '<path d="M32 24 Q50 35 68 24 L68 35 Q50 46 32 35 Z"/>' +
    '<path d="M37 40 L34 79"/><path d="M63 40 L66 79"/>',

  // Financial — the same job, a different shelf.
  Mortgage: '<path d="M22 50 L50 26 L78 50"/><path d="M30 50 L30 79 L70 79 L70 50"/><path d="M44 79 L44 60 L56 60 L56 79"/>',
  Auto:     '<path d="M20 60 L26 42 L74 42 L80 60 L80 70 L20 70 Z"/><circle cx="33" cy="70" r="6"/><circle cx="67" cy="70" r="6"/>',
  Card:     '<rect x="20" y="34" width="60" height="38" rx="5"/><path d="M20 46 L80 46"/><path d="M30 60 L48 60"/>',
  Savings:  '<path d="M28 44 Q28 32 50 32 Q72 32 72 44 L72 68 Q72 76 62 76 L38 76 Q28 76 28 68 Z"/><path d="M46 32 L46 22"/><path d="M54 32 L54 22"/>',
  Investing:'<path d="M22 72 L40 52 L54 62 L78 30"/><path d="M62 30 L78 30 L78 46"/>',
};

/** Anything unmapped still gets a mark rather than a hole. */
export const FALLBACK_SILHOUETTE = '<rect x="28" y="30" width="44" height="48" rx="4"/><path d="M28 62 L44 48 L58 62 L72 50"/>';

export function silhouetteFor(category: string): string {
  return SILHOUETTE[category] ?? FALLBACK_SILHOUETTE;
}

/**
 * The full card field: the item's own hue as a soft two-stop ground, its
 * silhouette, and its name wrapped over two lines. Deterministic, self-contained,
 * and incapable of 404ing — it is markup, not a file.
 */
export function packshot(
  item: { id: string; name: string; category: string; hex: string },
  opts: { withName?: boolean; square?: boolean } = {},
): string {
  const words = item.name.split(' ');
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(' ');
  const l2 = words.slice(mid).join(' ');
  const g = `g${item.id.replace(/[^a-z0-9]/gi, '')}`;
  // A 4:5 field sliced into a square crops the silhouette to a flat wash. The
  // hero needs its own box, not a crop of the card's.
  const H = opts.square ? 100 : 125;
  const shadowY = opts.square ? 79 : 86;
  // A card that shows its own name does not need it painted into the field as well;
  // duplicated it just reads as clutter. Only the bare field carries the label.
  const label = opts.withName === false ? '' : `
  <text x="50" y="104" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="6.4" font-weight="700" fill="${item.hex}" opacity=".92">${esc(l1)}</text>
  <text x="50" y="113" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif"
        font-size="6.4" font-weight="700" fill="${item.hex}" opacity=".92">${esc(l2)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(item.name)}">
  <defs><linearGradient id="${g}" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="${item.hex}" stop-opacity=".34"/>
    <stop offset="1" stop-color="${item.hex}" stop-opacity=".13"/>
  </linearGradient></defs>
  <rect width="100" height="${H}" fill="url(#${g})"/>
  <ellipse cx="50" cy="${shadowY}" rx="26" ry="3.5" fill="${item.hex}" opacity=".18"/>
  <g fill="none" stroke="${item.hex}" stroke-opacity=".72" stroke-width="2.1"
     stroke-linecap="round" stroke-linejoin="round">${silhouetteFor(item.category)}</g>${label}
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
