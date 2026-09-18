import { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { readSigningConfig, SIGNING_CONFIGURATION_UNAVAILABLE } from '@/auth/signingConfig.mjs';
import { storeFor, tokenHash } from '@/auth/accounts';
import { authorityFor, customerAuthority, type TenantGrant } from '@/auth/authority';
import { assertFederationSession } from '@/auth/oidc';

export interface JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  type?: 'access' | 'service';
  sid?: string;
  jti?: string;
  roles?: string[];
  permissions?: string[];
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  authMethod?: 'password' | 'oidc';
}

export interface AuthContext {
  user?: JWTPayload;
  isAuthenticated: boolean;
  /** Server-loaded current authority; never copied from JWT claims. */
  authority?: { grants: TenantGrant[]; accountRevision?: number; credentialId?: string; federation?: import('@/auth/store').FederationSession };
}

const extractToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export const jwt = (options?: {
  required?: boolean;
  roles?: string[];
  permissions?: string[];
  accountSession?: boolean;
  allowPasswordChange?: boolean;
}): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> => {
  return createMiddleware(async (c, next) => {
    const { required = true, roles = [], permissions = [] } = options || {};
    
    const authorization = c.req.header('Authorization');
    const token = extractToken(authorization);
    
    if (!token) {
      if (required) {
        return c.json({ error: 'Authorization token required' }, 401);
      }
      c.set('auth', { isAuthenticated: false });
      return next();
    }
    
    const signing = readSigningConfig(c.env);
    if (!signing) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: SIGNING_CONFIGURATION_UNAVAILABLE }, 503);
    }

    try {
      const { payload } = await jose.jwtVerify(token, signing.key, {
        issuer: signing.issuer,
        audience: signing.audience,
        algorithms: ['HS256'],
      });
      // Refresh credentials are accepted only by the session-renewal endpoint.
      if (payload.type === 'refresh') {
        return c.json({ error: 'Invalid token' }, 401);
      }

      // Signed claims still need a valid identity and exact-membership arrays.
      // Inspect whitespace only; accepted subjects and authority values stay intact.
      if (typeof payload.sub !== 'string' || !payload.sub.trim()
        || (payload.roles !== undefined && !isStringArray(payload.roles))
        || (payload.permissions !== undefined && !isStringArray(payload.permissions))) {
        return c.json({ error: 'Invalid token' }, 401);
      }
      
      // Only the non-enforced demo boundary retains old, untyped credentials.
      if (payload.type !== 'access' && payload.type !== 'service'
        && (payload.type !== undefined || c.env.AUTH_MODE === 'enforced')) {
        return c.json({ error: 'Invalid token' }, 401);
      }
      if (options?.accountSession && payload.type !== 'access') {
        return c.json({ error: 'Operator session required' }, 401);
      }
      if (payload.type !== undefined && (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp))) {
        return c.json({ error: 'Invalid token' }, 401);
      }
      let jwtPayload = payload as unknown as JWTPayload;
      let authority: AuthContext['authority'];
      if (payload.type === 'access') {
        if (typeof payload.sid !== 'string' || !payload.sid.trim()) return c.json({ error: 'Invalid token' }, 401);
        const store = storeFor(c.env);
        const session = await store.getSession(payload.sid);
        if (!session || session.jti !== payload.sid || session.accountId !== payload.sub
          || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
          return c.json({ error: 'Invalid token' }, 401);
        }
        const account = await store.getById(payload.sub);
        if (!account || account.id !== payload.sub || account.disabled
          || !isStringArray(account.roles) || account.roles.length === 0
          || !account.roles.every(role => role.trim()) || !isStringArray(account.permissions)) {
          return c.json({ error: 'Invalid token' }, 401);
        }
        if (account.must_change_password && !options?.allowPasswordChange) {
          return c.json({ error: 'Password change required' }, 403);
        }
        await assertFederationSession(c.env, account, session, payload.authMethod);
        jwtPayload = { ...jwtPayload, email: account.email, name: account.name,
          roles: [...account.roles], permissions: [...account.permissions] };
        if (customerAuthority(c.env)) authority = {
          // Selfservice/recovery does not require membership storage to work.
          grants: options?.accountSession ? [] : await authorityFor(c.env).grants(account.id),
          accountRevision: account.updatedAt ?? 0,
          ...(session.federation ? { federation: session.federation } : {}),
        };
      } else if (payload.type === 'service' && customerAuthority(c.env)) {
        if (typeof payload.jti !== 'string' || !payload.jti) return c.json({ error: 'Invalid token' }, 401);
        const credential = await authorityFor(c.env).credential(payload.jti);
        if (!credential || credential.id !== payload.jti || credential.subject !== payload.sub || credential.revokedAt !== null
          || credential.expiresAt !== payload.exp || credential.expiresAt * 1000 <= Date.now()
          || credential.tokenHash !== await tokenHash(token)) return c.json({ error: 'Invalid token' }, 401);
        jwtPayload = { ...jwtPayload, roles: [credential.role], permissions: credential.role === 'admin' ? ['*'] : ['read'] };
        authority = { grants: [{ tenant: credential.tenant, role: credential.role, revision: credential.id }], credentialId: credential.id };
      }
      
      if (roles.length > 0) {
        const userRoles = jwtPayload.roles || [];
        const hasRole = roles.some(role => userRoles.includes(role));
        if (!hasRole) {
          return c.json({ error: 'Insufficient role permissions' }, 403);
        }
      }
      
      if (permissions.length > 0) {
        const userPermissions = jwtPayload.permissions || [];
        const hasPermission = permissions.every(permission => 
          userPermissions.includes(permission)
        );
        if (!hasPermission) {
          return c.json({ error: 'Insufficient permissions' }, 403);
        }
      }
      
      c.set('auth', {
        user: jwtPayload,
        isAuthenticated: true,
        ...(authority ? { authority } : {}),
      });
      
      return next();
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return c.json({ error: 'Token expired' }, 401);
      }
      if (error instanceof jose.errors.JWTInvalid) {
        return c.json({ error: 'Invalid token' }, 401);
      }
      return c.json({ error: 'Authentication failed' }, 401);
    }
  });
};

export const apiKey = (options?: {
  headerName?: string;
  required?: boolean;
}): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> => {
  return createMiddleware(async (c, next) => {
    const { headerName = 'X-API-Key', required = true } = options || {};
    
    const apiKey = c.req.header(headerName);
    
    if (!apiKey) {
      if (required) {
        return c.json({ error: 'API key required' }, 401);
      }
      c.set('auth', { isAuthenticated: false });
      return next();
    }
    
    const validApiKeys = c.env.API_KEYS?.split(',') || [];
    
    if (!validApiKeys.includes(apiKey)) {
      return c.json({ error: 'Invalid API key' }, 401);
    }
    
    c.set('auth', {
      user: { sub: `api-key-${apiKey.substring(0, 8)}` },
      isAuthenticated: true,
    });
    
    return next();
  });
};

export const composite = (
  ...middlewares: MiddlewareHandler[]
): MiddlewareHandler => {
  return createMiddleware(async (c, next) => {
    for (const middleware of middlewares) {
      let nextCalled = false;
      const result = await middleware(c as any, async () => {
        nextCalled = true;
      });
      
      if (result) return result;
      if (!nextCalled) return;
    }
    return next();
  });
};
