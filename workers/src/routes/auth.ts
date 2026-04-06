import { Hono } from 'hono';
import { generateId } from '../utils/id';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export const authRoutes = new Hono<{ Bindings: Env }>();

// Register new user + org
authRoutes.post('/register', async (c) => {
  const body = await c.req.json();
  const { email, password, firstName, lastName, orgName, orgType, regionCode } = body;

  if (!email || !password || !firstName || !lastName) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const db = c.env.DB;

  // Check if email already exists
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const orgId = generateId();
  const userId = generateId();
  const slug = (orgName || `${firstName}-${lastName}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);

  // Hash password (using Web Crypto API available in Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Create org + user in a batch
  const batch = [
    db.prepare(
      `INSERT INTO organisations (id, slug, name, org_type, region_code) VALUES (?, ?, ?, ?, ?)`
    ).bind(orgId, slug, orgName || `${firstName}'s Workspace`, orgType || 'individual', regionCode || 'NA_ASHRAE'),

    db.prepare(
      `INSERT INTO users (id, org_id, email, password_hash, role, first_name, last_name, is_verified)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, 1)`
    ).bind(userId, orgId, email, passwordHash, firstName, lastName),
  ];

  await db.batch(batch);

  // Create session
  const token = generateId() + '-' + generateId();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await db.prepare(
    'INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, orgId, token, expiresAt).run();

  return c.json({
    token,
    user: { id: userId, email, firstName, lastName, role: 'admin', isVerified: true },
    organisation: { id: orgId, name: orgName || `${firstName}'s Workspace`, type: orgType || 'individual', slug, regionCode: regionCode || 'NA_ASHRAE' }
  }, 201);
});

// Login
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

  const db = c.env.DB;

  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const user = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ? AND u.password_hash = ?`
  ).bind(email, passwordHash).first();

  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  // Create session
  const token = generateId() + '-' + generateId();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    'INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, user.id, user.org_id, token, expiresAt).run();

  return c.json({
    token,
    user: {
      id: user.id, email: user.email, firstName: user.first_name,
      lastName: user.last_name, role: user.role, isVerified: !!user.is_verified
    },
    organisation: {
      id: user.org_id, name: user.org_name, type: user.org_type,
      slug: user.slug, regionCode: user.region_code
    }
  });
});

// Logout
authRoutes.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return c.json({ ok: true });
});

// Get current session user
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

  const token = authHeader.slice(7);
  const db = c.env.DB;

  const result = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organisations o ON o.id = s.org_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();

  if (!result) return c.json({ error: 'Session expired' }, 401);

  return c.json({
    user: {
      id: result.id, email: result.email, firstName: result.first_name,
      lastName: result.last_name, role: result.role, isVerified: !!result.is_verified
    },
    organisation: {
      id: result.org_id, name: result.org_name, type: result.org_type,
      slug: result.slug, regionCode: result.region_code
    }
  });
});
