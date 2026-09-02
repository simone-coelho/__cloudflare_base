// src/content/lifecycle.ts
// A piece is live when its status says so AND the clock is inside its window.
// The window is the "publish and expire" the scope appendix promises in 1.3;
// the eligibility gate runs before any scoring, so an expired piece cannot be
// chosen no matter how well it would have scored.

import type { ContentPiece } from './types';

export function windowBounds(p: Pick<ContentPiece, 'window'>): { from: number | null; to: number | null } {
  const parse = (v: string | undefined) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  return { from: parse(p.window?.from), to: parse(p.window?.to) };
}

export function isLiveAt(p: ContentPiece, nowMs: number): boolean {
  if (p.lifecycle.status !== 'live') return false;
  const { from, to } = windowBounds(p);
  if (from !== null && nowMs < from) return false;
  if (to !== null && nowMs >= to) return false;
  return true;
}
