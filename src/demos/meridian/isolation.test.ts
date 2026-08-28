// src/demos/meridian/isolation.test.ts
//
// THE ISOLATION CHARTER, ENFORCED.
//
// Meridian shares a Worker with the Coach demo, Bright Hour, and the banking
// surface. On the day, all of them may be live at once — a teammate rehearsing
// Coach while Opticon runs. The charter in README.md says Meridian owns its own
// object, its own table, its own key prefixes and its own ids, and imports
// nothing from outside except `src/reflex/core` (deliberately, so the stage
// shows the real engine rather than a copy of it).
//
// A charter nobody checks is a comment. These are the checks. They are static —
// no server, no network — because the failure they guard against is somebody
// adding an import or a table name months from now, not a runtime fault.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/demos/meridian';
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const sources = files.map((f) => ({ f, src: readFileSync(join(DIR, f), 'utf8') }));
const all = sources.map((s) => s.src).join('\n');

describe('isolation charter', () => {
  it('imports nothing outside itself except the shared reflex engine', () => {
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/from\s+'(@\/[^']+|\.\.\/[^']+)'/g)) {
        const spec = m[1]!;
        const allowed = spec === '@/reflex/core'          // the one deliberate exception
          || spec.startsWith('@/types/');                 // ambient types only
        if (!allowed) offenders.push(`${f} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is imported by nobody else — no other demo depends on it', () => {
    const roots = ['src/routes', 'src/services', 'src/demos'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      let entries: string[] = [];
      try { entries = readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)); }
      catch { return; }
      for (const e of entries) {
        const p = join(dir, e);
        if (e.endsWith('/')) { if (!p.includes('meridian')) walk(p.slice(0, -1)); continue; }
        if (!e.endsWith('.ts')) continue;
        if (p.includes('meridian')) continue;
        const src = readFileSync(p, 'utf8');
        if (/from\s+'[^']*demos\/meridian/.test(src)) offenders.push(p);
      }
    };
    for (const r of roots) walk(r);
    // src/index.ts mounts the routes; that is the intended single seam.
    expect(offenders).toEqual([]);
  });

  it('WRITES only to its own tables, and reads only shared reference data', () => {
    // Scan the SQL that is actually EXECUTED, not the whole file. Two earlier
    // versions matched English in comments — an apostrophe in prose ("the
    // engine's own") acts as a string delimiter, so "from a partner survey"
    // came back as a table named `a`. Anchor on the real call sites instead.
    //
    // The charter is about MUTATION, not access. Meridian may read shared
    // read-only reference data — copying the published census into an
    // `mrd_geo_census` would be duplication for its own sake — but it must
    // never write outside its own namespace, because that is how one demo
    // corrupts another's state mid-rehearsal.
    // geo_xref is the ZIP → metro → region crosswalk the cohort ladder walks;
    // like geo_census it is published reference data, read-only to us.
    const SHARED_READONLY = new Set(['geo_census', 'geo_xref']);

    const sqlText: string[] = [];
    for (const { src } of sources) {
      for (const m of src.matchAll(/\.prepare\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) sqlText.push(m[1]!);
      for (const m of src.matchAll(/\b(?:const|let)\s+sql\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) sqlText.push(m[1]!);
    }

    const written = new Set<string>();
    const read = new Set<string>();
    for (const sql of sqlText) {
      for (const m of sql.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        written.add(m[1]!.toLowerCase());
      }
      for (const m of sql.matchAll(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        read.add(m[1]!.toLowerCase());
      }
    }

    expect(written.size + read.size).toBeGreaterThan(0);   // the scan must find our SQL
    // Every write is ours.
    expect([...written].filter((t) => !t.startsWith('mrd_'))).toEqual([]);
    // Every read is either ours or an explicitly allowed shared reference table.
    expect([...read].filter((t) => !t.startsWith('mrd_') && !SHARED_READONLY.has(t))).toEqual([]);
  });

  it('namespaces every Optimizely key it creates under mrd_', () => {
    // The flag/event keys this demo mints. A bare key would collide with Coach's.
    const keys = [...all.matchAll(/\$\{KEY_PREFIX\}([a-z_]+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);
    const prefix = all.match(/const KEY_PREFIX\s*=\s*'([^']+)'/)?.[1];
    expect(prefix).toBe('mrd_');
    // And nothing writes a literal unprefixed flag key.
    expect(/flags\/v1[^`']*['"`]\s*\+\s*['"`](?!mrd_)/.test(all)).toBe(false);
  });

  it('owns a catalogue id space that cannot collide with another demo', () => {
    const retail = JSON.parse(readFileSync(join(DIR, 'catalog.retail.json'), 'utf8'));
    const financial = JSON.parse(readFileSync(join(DIR, 'catalog.financial.json'), 'utf8'));
    const blocks = JSON.parse(readFileSync(join(DIR, 'catalog.blocks.json'), 'utf8'));
    const ids = [...retail, ...financial, ...blocks].map((i: any) => i.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.every((id: string) => id.startsWith('MRD-'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);   // no duplicates within our own space
  });

  it('declares its own Durable Object rather than sharing one', () => {
    const src = readFileSync(join(DIR, 'MeridianReflex.ts'), 'utf8');
    expect(/export class MeridianReflex/.test(src)).toBe(true);
    // It must not reach for another demo's object binding.
    expect(/SHOPPER_REFLEX|BRIGHTHOUR|COACH_/.test(all)).toBe(false);
  });

  it('mounts every route under its own prefix', () => {
    const index = readFileSync('src/index.ts', 'utf8');
    const mounts = [...index.matchAll(/app\.route\('([^']+)',\s*meridianRoutes\)/g)].map((m) => m[1]!);
    expect(mounts).toEqual(['/meridian/api']);
  });
});
