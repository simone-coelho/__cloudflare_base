import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { jwt, type AuthContext } from '@/middleware/auth';
import { auditedRecovery, recoveryHuman } from '@/auth/subjectAudit';
import { listQuarantine, loadQuarantine, operateQuarantine, publicCase } from '@/ledger/quarantine';

const id = z.string().regex(/^[a-f0-9]{64}$/);
export const ledgerRecoveryRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables & { auth: AuthContext } }>();
ledgerRecoveryRoutes.use('*', jwt({ required: true, accountSession: true }));
ledgerRecoveryRoutes.use('*', async (c, next) => {
  const query = new URL(c.req.url).searchParams, keys = [...query.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => c.req.method === 'POST' || !['scope', 'after'].includes(key))
    || (c.req.param('id') && query.has('after'))) return c.json({ ok: false, error: 'Recovery selector unavailable' }, 400);
  await next();
});
ledgerRecoveryRoutes.get('/', async c => {
  const scope = z.enum(['tenant', 'unassigned']).parse(c.req.query('scope') ?? 'tenant');
  const tenant = scope === 'unassigned' ? null : c.get('tenant'), after = c.req.query('after');
  if (after !== undefined) id.parse(after);
  if (Object.keys(c.req.query()).some(key => !['scope', 'after'].includes(key))) return c.json({ ok: false }, 400);
  return auditedRecovery(c, tenant, 'list', {}, async () => c.json({ ok: true, ...await listQuarantine(c.env, tenant, after) }));
});
ledgerRecoveryRoutes.get('/:id', async c => {
  const caseId = id.parse(c.req.param('id')), scope = z.enum(['tenant', 'unassigned']).parse(c.req.query('scope') ?? 'tenant');
  const tenant = scope === 'unassigned' ? null : c.get('tenant');
  if (Object.keys(c.req.query()).some(key => key !== 'scope')) return c.json({ ok: false }, 400);
  return auditedRecovery(c, tenant, 'status', { caseId }, async () => {
    const found = await loadQuarantine(c.env, caseId);
    if (!found || found.value.tenant !== tenant) return c.json({ ok: false }, 404);
    await recoveryHuman(c, found.value.tenant);
    return c.json({ ok: true, case: publicCase(found.value) });
  });
});
ledgerRecoveryRoutes.post('/:id/:action', async c => {
  const caseId = id.parse(c.req.param('id')), action = z.enum(['redrive', 'resolve']).parse(c.req.param('action'));
  const text = await c.req.text(); if (new TextEncoder().encode(text).length > 4096) return c.json({ ok: false }, 413);
  const body = z.object({ digest: id, revision: z.number().int().positive(), scope: z.enum(['tenant', 'unassigned']),
    disposition: z.enum(['irrecoverable', 'disposal_pending']).optional() }).strict().parse(JSON.parse(text));
  if ((action === 'redrive') === (body.disposition !== undefined)) return c.json({ ok: false }, 400);
  const tenant = body.scope === 'unassigned' ? null : c.get('tenant');
  return auditedRecovery(c, tenant, action, { caseId, digest: body.digest, revision: body.revision }, async () => c.json({ ok: true,
    case: await operateQuarantine(c.env, caseId, body, action, body.disposition, async actual => {
      if (actual !== tenant) throw new Error('Recovery ownership mismatch'); await recoveryHuman(c, actual);
    }) }));
});
