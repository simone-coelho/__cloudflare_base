import { Hono } from 'hono';
import { z } from 'zod';
import * as jose from 'jose';
import type { Env } from '@/types/env';
import { jwt } from '@/middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  roles: z.array(z.string()).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string(),
});

auth.post('/login', async (c) => {
  try {
    const { email, password } = LoginSchema.parse(await c.req.json());
    
    const userKey = `user:${email}`;
    const user = await c.env.CACHE.get(userKey, 'json') as any;
    
    if (!user || user.password !== password) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles || [],
      permissions: user.permissions || [],
    };
    
    const accessToken = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(c.env.JWT_ISSUER)
      .setAudience(c.env.JWT_AUDIENCE)
      .setExpirationTime('15m')
      .sign(secret);
    
    const refreshToken = await new jose.SignJWT({ sub: user.id, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(c.env.JWT_ISSUER)
      .setAudience(c.env.JWT_AUDIENCE)
      .setExpirationTime('7d')
      .sign(secret);
    
    await c.env.SESSIONS.put(`refresh:${user.id}`, refreshToken, {
      expirationTtl: 7 * 24 * 60 * 60,
    });
    
    return c.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
      expiresIn: 900,
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 400);
  }
});

auth.post('/register', async (c) => {
  try {
    const { email, password, name, roles = ['user'] } = RegisterSchema.parse(await c.req.json());
    
    const userKey = `user:${email}`;
    const existingUser = await c.env.CACHE.get(userKey);
    
    if (existingUser) {
      return c.json({ error: 'User already exists' }, 409);
    }
    
    const user = {
      id: crypto.randomUUID(),
      email,
      password,
      name,
      roles,
      permissions: roles.includes('admin') ? ['*'] : ['read'],
      createdAt: Date.now(),
    };
    
    await c.env.CACHE.put(userKey, JSON.stringify(user));
    await c.env.CACHE.put(`user_id:${user.id}`, JSON.stringify(user));
    
    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ error: 'Registration failed' }, 400);
  }
});

auth.post('/refresh', async (c) => {
  try {
    const { refreshToken } = RefreshSchema.parse(await c.req.json());
    
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(refreshToken, secret, {
      issuer: c.env.JWT_ISSUER,
      audience: c.env.JWT_AUDIENCE,
    });
    
    const storedToken = await c.env.SESSIONS.get(`refresh:${payload.sub}`);
    if (storedToken !== refreshToken) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }
    
    const userKey = `user_id:${payload.sub}`;
    const user = await c.env.CACHE.get(userKey, 'json') as any;
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    const newPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles || [],
      permissions: user.permissions || [],
    };
    
    const accessToken = await new jose.SignJWT(newPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(c.env.JWT_ISSUER)
      .setAudience(c.env.JWT_AUDIENCE)
      .setExpirationTime('15m')
      .sign(secret);
    
    return c.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
      },
      expiresIn: 900,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    return c.json({ error: 'Token refresh failed' }, 401);
  }
});

auth.post('/logout', jwt(), async (c) => {
  try {
    const auth = c.get('auth');
    if (auth.user) {
      await c.env.SESSIONS.delete(`refresh:${auth.user.sub}`);
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

auth.get('/me', jwt(), async (c) => {
  const auth = c.get('auth');
  
  if (!auth.user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }
  
  return c.json({
    user: auth.user,
  });
});

export { auth as authRoutes };