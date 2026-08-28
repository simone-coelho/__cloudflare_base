// Generates the curated scene stills. Deterministic: same input, same bytes.
//
// These are illustrations, not photographs, and deliberately so — a demo that
// shows invented photography of a wedding invites exactly the question we are
// trying to answer. An abstract still is honest about being artwork, and the
// point of the beat is that the SET IS CLOSED, not that the pictures are real.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'meridian', 'scenes');
mkdirSync(OUT, { recursive: true });

// id | warm base | accent | composition seed
const SCENES = [
  ['wedding',          '#F3E8E4', '#A9736A', 'arc'],
  ['black-tie',        '#22212A', '#C9A227', 'night'],
  ['new-job',          '#E9EAEE', '#3F4A63', 'grid'],
  ['cold-snap',        '#E4EAEE', '#41697F', 'horizon'],
  ['weekend-away',     '#E7EBE4', '#5C7350', 'horizon'],
  ['hard-to-buy-for',  '#EFE3D2', '#8B5E3C', 'scatter'],
  ['graduation',       '#EDE4EE', '#7A5A86', 'arch'],
  ['investment-piece', '#EFEAE4', '#7A5F3E', 'arch'],
  ['first-home',       '#E6EBEF', '#1F4E79', 'arch'],
  ['new-car',          '#E7EAEC', '#3D5A6C', 'horizon'],
  ['starting-out',     '#EAEFEA', '#4E7A5A', 'scatter'],
  ['paying-down',      '#EFEAE4', '#7A5F3E', 'grid'],
  ['saving-up',        '#E5EDEA', '#2F6F62', 'arc'],
  ['retirement',       '#EAE8F0', '#4A4A82', 'horizon'],
];

const forms = (kind, a) => {
  switch (kind) {
    case 'arch':
      return `<path d="M120 300 Q120 130 240 130 Q360 130 360 300 Z" fill="${a}" opacity=".16"/>
              <path d="M170 300 Q170 185 240 185 Q310 185 310 300 Z" fill="${a}" opacity=".28"/>`;
    case 'arc':
      return `<circle cx="240" cy="215" r="118" fill="${a}" opacity=".14"/>
              <path d="M122 215 A118 118 0 0 1 358 215 Z" fill="${a}" opacity=".26"/>`;
    case 'night':
      return `<circle cx="330" cy="120" r="46" fill="${a}" opacity=".55"/>
              <rect x="60" y="232" width="360" height="8" rx="4" fill="${a}" opacity=".38"/>
              <rect x="118" y="252" width="244" height="52" rx="6" fill="${a}" opacity=".16"/>`;
    case 'grid':
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) =>
        `<rect x="${132 + c * 76}" y="${132 + r * 62}" width="60" height="48" rx="5" fill="${a}" opacity="${0.12 + ((r + c) % 3) * 0.08}"/>`).join('')).join('');
    case 'horizon':
      return `<rect x="0" y="236" width="480" height="120" fill="${a}" opacity=".18"/>
              <path d="M0 236 L150 168 L268 236 Z" fill="${a}" opacity=".3"/>
              <path d="M212 236 L330 152 L446 236 Z" fill="${a}" opacity=".22"/>`;
    default:
      return [[168, 168, 40], [268, 142, 30], [316, 232, 46], [176, 258, 28], [244, 214, 34]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${a}" opacity=".2"/>`).join('');
  }
};

for (const [id, bg, accent, kind] of SCENES) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 640" width="480" height="640" role="img" aria-label="${id}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity=".55"/>
  </linearGradient></defs>
  <rect width="480" height="640" fill="url(#g)"/>
  <g transform="translate(0,142)">${forms(kind, accent)}</g>
  <text x="24" y="614" font-family="ui-monospace, monospace" font-size="10" letter-spacing="1.6"
        fill="${kind === 'night' ? '#EDE6D4' : '#3A342C'}" opacity=".62">APPROVED STILL · ${id.toUpperCase()}</text>
</svg>\n`;
  writeFileSync(join(OUT, `${id}.svg`), svg);
}
console.log(`${SCENES.length} scene stills written to public/meridian/scenes/`);
