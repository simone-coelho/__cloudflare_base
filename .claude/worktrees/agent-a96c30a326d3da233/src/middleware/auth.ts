import { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import type { Env } from '@/types/env';

export interface JWTPayload {
  sub: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

export interface AuthContext {
  user?: JWTPayload;
  isAuthenticated: boolean;
}

const extractToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
};

export const jwt = (options?: {
  required?: boolean;
  roles?: string[];
  permissions?: string[];
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
    
    try {
      const secret = new TextEncoder().encode(c.env.JWT_SECRET);
      const { payload } = await jose.jwtVerify(token, secret, {
        issuer: c.env.JWT_ISSUER,
        audience: c.env.JWT_AUDIENCE,
      });
      
      const jwtPayload = payload as unknown as JWTPayload;
      
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