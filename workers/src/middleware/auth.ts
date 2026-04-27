import { Context, Next } from 'hono';

export interface AuthUser {
  id: string;
  email: string;
  orgId: string;
  role: string;
  isPlatformAdmin: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const db = c.env.DB as D1Database;

  const session = await db.prepare(
    `SELECT s.user_id, s.org_id, u.email, u.role, u.is_platform_admin
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();

  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  c.set('user', {
    id: session.user_id as string,
    email: session.email as string,
    orgId: session.org_id as string,
    role: session.role as string,
    isPlatformAdmin: Number(session.is_platform_admin ?? 0) === 1,
  });

  // Update last_seen
  await db.prepare('UPDATE users SET last_seen_at = datetime(\'now\') WHERE id = ?')
    .bind(session.user_id).run();

  await next();
}

/**
 * Platform-admin guard. Must run AFTER `authMiddleware`.
 *
 * Platform admins are the creator layer (C4 Technologies). They can see
 * across orgs, impersonate tenants for support, override plan/seat limits,
 * and view the global audit feed. They are ALSO ordinary admins of their
 * own tenant — the flag is orthogonal to `role` so dogfooding still works.
 */
export async function requirePlatformAdmin(c: Context, next: Next) {
  const user = c.get('user') as AuthUser | undefined;
  if (!user || !user.isPlatformAdmin) {
    return c.json({ error: 'Platform admin privilege required' }, 403);
  }
  await next();
}
