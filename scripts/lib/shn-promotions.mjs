// scripts/lib/shn-promotions.mjs
// ─────────────────────────────────────────────────────────────────────────────
// THE POOL, AS QVC DESCRIBES IT: pieces of CONTENT, not products.
//
// Garrett's FPO visual is unambiguous — "Spring Beauty Event", "Refresh Your
// Home", "Fashion Essentials", "Top Kitchen Picks". Each card is an editorial
// image, a promotion title, a badge, and one Shop Now. There is no price, no
// strikethrough, no star rating and no Add to Cart anywhere on it.
//
// That distinction is the whole positioning. Our own competitive dossier:
// "Constructor already owns product discovery on both properties — arguing
// item-recs is arguing on their incumbent's turf; arguing offer/content
// decisioning is the open lane." A module dressed as a product grid argues on
// the incumbent's turf by accident. So the pool is promotions.
//
// Each carries exactly the metadata Jamie named — category, subcategory, brand —
// plus the badge from Garrett's own screenshot as `offerType`, and a price band.
// Twelve live on a typical day growing to twenty, her numbers from 22 September.
// ─────────────────────────────────────────────────────────────────────────────

/** The six departments Jamie listed, in her order. */
export const CATEGORIES = ['Beauty & Wellness', 'Jewelry', 'Fashion', 'For the Home',
  'Kitchen & Table', 'Electronics & Tech'];

/** The badge vocabulary, read off the FPO visual. */
export const BADGES = ['Best Seller', 'Limited Time', 'Clearance', 'Featured Value',
  'Just Reduced', 'Easy Pay Event'];

/**
 * A promotion. `art` is the prompt its creative is generated from, once, at
 * design time (scripts/generate-shn-art.mjs), and committed — never generated
 * on the serving path.
 */
const P = (id, title, category, subcategory, brand, badge, band, art, blurb) =>
  ({ id, title, category, subcategory, brand, badge, band, art, blurb });

/** The twelve live on a typical day. */
export const LIVE = [
  // ── Beauty & Wellness ──
  P('SHN-BEA-01', 'Spring Beauty Event', 'Beauty & Wellness', 'Skincare', 'Solene', 'Limited Time', 'core',
    'Soft editorial flat-lay of pastel pink skincare bottles and a glass jar among cherry blossom petals, bright airy daylight, blush and cream palette, shallow depth of field, no text, no logos, no people',
    'Serums, creams and the season’s freshest skincare.'),
  P('SHN-BEA-02', 'Everyday Glow Picks', 'Beauty & Wellness', 'Bath & Body', 'Fieldnote', 'Best Seller', 'entry',
    'Warm editorial still life of milled soap bars, a rolled linen towel and a small amber bottle on a pale marble ledge, soft morning light, cream and sand palette, no text, no logos, no people',
    'The bath and body edit our customers keep reordering.'),

  // ── Jewelry ──
  P('SHN-JEW-01', 'Fashion Essentials', 'Jewelry', 'Earrings', 'Larkspur Silver', 'Clearance', 'entry',
    'Editorial still life of a gold wristwatch, a soft blush handbag and delicate hoop earrings arranged on a pale peach surface, warm directional light, rose and gold palette, no text, no logos, no people',
    'Watches, hoops and the pieces that finish an outfit.'),
  P('SHN-JEW-02', 'The Jewelry Vault', 'Jewelry', 'Necklaces & Pendants', 'Vireo Fine', 'Featured Value', 'elevated',
    'Editorial still life of fine gold necklaces and a pendant draped over a cream velvet riser, deep warm shadow, champagne and ivory palette, no text, no logos, no people',
    'Fine gold and sterling, valued for the season.'),

  // ── Fashion ──
  P('SHN-FAS-01', 'Cozy Layers Shop', 'Fashion', 'Tops & Knits', 'Nell & Bray', 'Just Reduced', 'core',
    'Editorial flat-lay of folded cable-knit sweaters in oatmeal and sage on a pale wooden surface with a sprig of eucalyptus, soft window light, warm neutral palette, no text, no logos, no people',
    'Knits, wraps and everything worth layering.'),
  P('SHN-FAS-02', 'Summer Sandals', 'Fashion', 'Shoes & Slippers', 'Trueform', 'Limited Time', 'entry',
    'Editorial still life of tan leather sandals and espadrilles arranged on warm sand with a woven bag edge, bright sunlight, sand and terracotta palette, no text, no logos, no people',
    'Sandals, slides and warm-weather footwear.'),

  // ── For the Home ──
  P('SHN-HOM-01', 'Refresh Your Home', 'For the Home', 'Decor & Accents', 'Wren Hollow', 'Featured Value', 'core',
    'Bright airy sunroom with a rattan chair, striped cushions and potted greenery by a large window, soft natural daylight, sage and cream palette, editorial interiors photography, no text, no logos, no people',
    'Everything for a lighter, brighter room.'),
  P('SHN-HOM-02', 'Bedding & Bath Event', 'For the Home', 'Bedding', 'Havenmoor', 'Easy Pay Event', 'core',
    'Editorial still life of folded white and dove-grey bedding with a quilted coverlet on a pale oak bench, soft morning light, white and greige palette, no text, no logos, no people',
    'Sheets, coverlets and towels, on Easy Pay.'),

  // ── Kitchen & Table ──
  P('SHN-KIT-01', 'Top Kitchen Picks', 'Kitchen & Table', 'Countertop Cooking', 'Marlow & Bell', 'Best Seller', 'elevated',
    'Bright editorial kitchen counter with a stand mixer, pastel ceramic mixing bowls and fresh herbs in a jar, clean white subway tile behind, soft daylight, mint and butter palette, no text, no logos, no people',
    'The countertop pieces that earn their space.'),
  P('SHN-KIT-02', 'Cookware Clearance', 'Kitchen & Table', 'Cookware & Dutch Ovens', 'Copperline', 'Clearance', 'core',
    'Editorial still life of enamel cast-iron pots in cream and sage stacked on a rustic wooden table with a folded linen cloth, warm kitchen light, cream and olive palette, no text, no logos, no people',
    'Dutch ovens, skillets and sets, reduced.'),

  // ── Electronics & Tech ──
  P('SHN-ELE-01', 'Smart Home Savings', 'Electronics & Tech', 'Smart Home', 'Halo Field', 'Just Reduced', 'core',
    'Editorial still life of a small smart speaker and a tablet-style display on a light oak console with a trailing plant, soft cool daylight, white and pale grey palette, no text, no logos, no people',
    'Displays, speakers and everyday smart devices.'),
  P('SHN-ELE-02', 'Sound & Listening', 'Electronics & Tech', 'Headphones & Speakers', 'Quilla Audio', 'Easy Pay Event', 'elevated',
    'Editorial still life of over-ear headphones and wireless earbuds on a charcoal felt surface beside a folded wool throw, soft directional light, slate and cream palette, no text, no logos, no people',
    'Headphones and speakers, on Easy Pay.'),
];

/** The eight that take the pool to the twenty Jamie wants to reach. */
export const GROWTH = [
  P('SHN-BEA-03', 'Hello Spring Beauty', 'Beauty & Wellness', 'Cosmetics', 'Fieldnote', 'Best Seller', 'entry',
    'Editorial flat-lay of tinted lip balms and a soft makeup brush among white spring blossom on a pale pink surface, bright airy light, blush palette, no text, no logos, no people',
    'Colour, brushes and the spring refresh.'),
  P('SHN-JEW-03', 'Gifts Under $50', 'Jewelry', 'Bracelets & Anklets', 'Coronet', 'Featured Value', 'entry',
    'Editorial still life of delicate silver bracelets on a cream ribbon beside a small gift box, soft warm light, ivory and silver palette, no text, no logos, no people',
    'Small pieces, easy to give.'),
  P('SHN-FAS-03', 'Extra Markdowns', 'Fashion', 'Bottoms', 'Trueform', 'Clearance', 'entry',
    'Editorial flat-lay of neatly folded dark ponte trousers and a soft grey tee on a pale linen surface, even soft light, charcoal and stone palette, no text, no logos, no people',
    'Final reductions across the fashion floor.'),
  P('SHN-HOM-03', 'Lighting Event', 'For the Home', 'Lighting', 'Lumen House', 'Limited Time', 'elevated',
    'Editorial interiors shot of a warm-lit arc floor lamp beside a linen armchair in a softly shadowed living room at dusk, amber and taupe palette, no text, no logos, no people',
    'Lamps and shades to warm a room.'),
  P('SHN-HOM-04', 'Storage & Organisation', 'For the Home', 'Storage & Organization', 'Wren Hollow', 'Just Reduced', 'entry',
    'Editorial still life of woven baskets and lidded canvas bins stacked on a pale shelf with folded towels, clean bright light, natural fibre palette, no text, no logos, no people',
    'Baskets, bins and everything tidied away.'),
  P('SHN-KIT-03', 'Tabletop & Entertaining', 'Kitchen & Table', 'Tabletop & Serveware', 'Marlow & Bell', 'Featured Value', 'core',
    'Editorial overhead of hand-glazed dinner plates, acacia serving boards and linen napkins set on a warm wooden table, soft daylight, terracotta and cream palette, no text, no logos, no people',
    'Plates, boards and the table you set.'),
  P('SHN-KIT-04', 'Coffee & Tea Shop', 'Kitchen & Table', 'Coffee & Tea', 'Fresco Nine', 'Best Seller', 'core',
    'Editorial still life of a glass coffee press, a stoneware mug and scattered coffee beans on a dark walnut counter, warm low light, espresso and cream palette, no text, no logos, no people',
    'Presses, kettles and the morning ritual.'),
  P('SHN-ELE-03', 'Personal Tech Deals', 'Electronics & Tech', 'Personal Tech', 'Halo Field', 'Clearance', 'entry',
    'Editorial still life of a slim fitness tracker and a charging stand on a pale grey surface with a rolled towel, clean cool light, white and mint palette, no text, no logos, no people',
    'Trackers, chargers and everyday tech.'),
];

/**
 * The winter piece. It exists for ONE beat: the snow condition Simone promised
 * QVC in writing — "a snow condition surfacing a winter offer for a shopper in
 * Washington and not for one in Florida". It is never eligible without the rule.
 */
export const WINTER = P('SHN-KIT-90', 'Snow Day Comfort Cooking', 'Kitchen & Table', 'Cookware & Dutch Ovens', 'Copperline', 'Limited Time', 'core',
  'Editorial kitchen scene of a steaming enamel cast-iron pot on a stovetop beside a window with heavy snow falling outside, warm lamp light on a wooden counter, cool blue daylight through the glass against warm amber interior, cosy winter cooking mood, no text, no logos, no people',
  'Dutch ovens, braisers and everything for a long slow simmer.');

/** The four QVC-defined defaults, held until the shopper clears the page gate. */
export const DEFAULT_IDS = ['SHN-KIT-01', 'SHN-HOM-01', 'SHN-BEA-01', 'SHN-JEW-01'];

export const ALL = [...LIVE, ...GROWTH, WINTER];
