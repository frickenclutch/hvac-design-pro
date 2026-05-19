import { Context, Next } from 'hono';

export interface AuthUser {
  id: string;
  email: string;
  orgId: string;
  role: string;
  isPlatformAdmin: boolean;
  /** Authority flag — orthogonal to role, mirrors `is_platform_admin`.
   *  When true, the user can act on permit submissions sent to their org
   *  (claim, approve, deny, request changes, post internal comments). */
  isPermitAuthority: boolean;
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

  // status = 'active' gate: a deactivated user's live token must stop
  // working immediately, not linger until its 30-day expiry. Deactivation
  // also purges their sessions, but this WHERE is the authoritative
  // backstop on the hot path for every authed request.
  const session = await db.prepare(
    `SELECT s.user_id, s.org_id, u.email, u.role,
            u.is_platform_admin, u.is_permit_authority
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')
       AND u.status = 'active'`
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
    isPermitAuthority: Number(session.is_permit_authority ?? 0) === 1,
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

/**
 * Permit-authority guard. Must run AFTER `authMiddleware`.
 *
 * Mirrors `requirePlatformAdmin` semantics — checks the orthogonal
 * `is_permit_authority` flag, not the role. Routes that perform
 * authority-side actions (claim a submission, make a decision, post
 * internal comments) sit behind this. Authority READS are open to
 * either party (gated per-record by `isParty()` in the route handler).
 */
export async function requirePermitAuthority(c: Context, next: Next) {
  const user = c.get('user') as AuthUser | undefined;
  if (!user || !user.isPermitAuthority) {
    return c.json({ error: 'Permit authority privilege required' }, 403);
  }
  await next();
}
