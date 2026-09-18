import type { Env } from '@/types/env';
import { connectorSecret, type WarehouseConfiguration } from './config';
import { connectorJson, ConnectorUnavailable, type ConnectorDeadline } from './model';

export interface WarehouseRow { id: string; subject: string; ts: number; expiresAt: number; hash: string; wire: string }
export interface WarehousePayload {
  version: 1; tenant: string; generation: string; operation: string; sequence: number;
  source: string; revision: string; sourceSequence: number; part: number; final: boolean; mode: 'replace' | 'barrier';
  total: number; sourceDigest: string; rows: WarehouseRow[]; cutoffs: Array<{ subject: string; at: number }>;
}
export interface WarehouseReadback { version: 1; operation: string; digest: string; sequence: number;
  rows: Array<{ id: string; hash: string }>; count: number; sourceCount: number | null; sourceDigest: string | null;
  cutoffs: Array<{ subject: string; at: number }>; currentRowsOnly: true; expiredRemaining: number }
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encoded = (value: unknown) => b64(new TextEncoder().encode(JSON.stringify(value)));
async function token(env: Env, config: WarehouseConfiguration): Promise<string> {
  let value: { privateKey?: string; publicKeyFingerprint?: string };
  try { value = JSON.parse(connectorSecret(env, config.keyPairRef)); } catch { throw new ConnectorUnavailable('policy'); }
  if (Object.keys(value).sort().join(',') !== 'privateKey,publicKeyFingerprint' || !/^SHA256:[A-Za-z0-9+/]{43}=$/.test(value.publicKeyFingerprint ?? '')
    || !/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/.test(value.privateKey ?? '')) throw new ConnectorUnavailable('policy');
  try {
    const pem = value.privateKey!.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), key = await crypto.subtle.importKey('pkcs8',
      Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000), identity = config.account + '.' + config.user;
    const wire = encoded({ alg: 'RS256', typ: 'JWT' }) + '.' + encoded({ iss: identity + '.' + value.publicKeyFingerprint, sub: identity, iat: now, exp: now + 60 });
    return wire + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(wire))));
  } catch { throw new ConnectorUnavailable('policy'); }
}
const handleValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export type SqlResult = { pending: true; handle: string } | { pending: false; value: unknown };
/** Fixed parameterized SQL only. A returned status URL is never followed. */
export async function warehouseStatement(env: Env, config: WarehouseConfiguration, operation: string, wire: string,
  readback: boolean, handle: string | undefined, deadline: ConnectorDeadline, authorize: () => Promise<void>, transport: () => void): Promise<SqlResult> {
  await authorize(); const credential = await token(env, config); await authorize(); deadline.live(); transport();
  if (!handleValid(operation) || (handle !== undefined && !handleValid(handle))) throw new ConnectorUnavailable('schema');
  const path = handle ? 'api/v2/statements/' + handle : 'api/v2/statements?async=true&requestId=' + operation + '&retry=true';
  const request = handle ? undefined : { statement: `CALL ${config.database}.${config.schema}.${readback ? 'READ_DELIVERY_V1' : config.procedure}(?)`,
    timeout: Math.max(1, Math.ceil(config.timeoutMs / 1000)), database: config.database, schema: config.schema,
    warehouse: config.warehouse, role: config.role, bindings: { '1': { type: 'TEXT', value: wire } } };
  const body = request ? JSON.stringify(request) : undefined;
  if (body && new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) throw new ConnectorUnavailable('limit');
  deadline.live(); transport(); deadline.charge?.();
  const response = await fetch(new URL(path, config.origin), { method: handle ? 'GET' : 'POST', redirect: 'manual', signal: deadline.signal,
    headers: { Authorization: 'Bearer ' + credential, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT', 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body } : {}) });
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => undefined); throw new ConnectorUnavailable('transport');
  }
  const raw = await connectorJson(response, config.responseBytes, deadline) as { statementHandle?: unknown; data?: unknown;
    resultSetMetaData?: { numRows?: unknown; rowType?: unknown[]; partitionInfo?: Array<{ rowCount?: unknown }> } };
  await authorize(); deadline.live(); transport();
  if (response.status === 202 || handle && response.status === 429) {
    if (!handleValid(raw.statementHandle) || handle && raw.statementHandle !== handle) throw new ConnectorUnavailable('schema');
    return { pending: true, handle: raw.statementHandle };
  }
  if (response.status !== 200 || !handleValid(raw.statementHandle) || handle && raw.statementHandle !== handle
    || raw.resultSetMetaData?.numRows !== 1 || raw.resultSetMetaData.rowType?.length !== 1
    || raw.resultSetMetaData.partitionInfo?.length !== 1 || raw.resultSetMetaData.partitionInfo[0]?.rowCount !== 1
    || !Array.isArray(raw.data) || raw.data.length !== 1 || !Array.isArray(raw.data[0]) || raw.data[0].length !== 1
    || typeof raw.data[0][0] !== 'string') throw new ConnectorUnavailable('transport');
  try { return { pending: false, value: JSON.parse(raw.data[0][0]) }; } catch { throw new ConnectorUnavailable('schema'); }
}
