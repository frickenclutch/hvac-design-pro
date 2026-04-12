import { Hono } from 'hono';

interface Env {
  DB: D1Database;
}

export const orgRoutes = new Hono<{ Bindings: Env }>();

// ── GET /api/org — get current user's org profile ───────────────────────────
orgRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const org = await db.prepare(
    `SELECT id, name, org_type, region_code, address_line1, city, state, zip, country, phone, settings, default_standard
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  return c.json({
    organisation: {
      id: org.id,
      name: org.name,
      orgType: org.org_type,
      regionCode: org.region_code,
      addressLine1: org.address_line1,
      city: org.city,
      state: org.state,
      zip: org.zip,
      country: org.country,
      phone: org.phone,
      settings: org.settings,
      defaultStandard: org.default_standard,
    }
  });
});

// ── PUT /api/org — update org profile (admin only) ──────────────────────────
orgRoutes.put('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can update organisation settings' }, 403);
  }

  const body = await c.req.json();
  const { name, orgType, regionCode, addressLine1, city, state, zip, country, phone, settings, defaultStandard } = body;

  // Build dynamic SET clause for partial updates
  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (orgType !== undefined) { updates.push('org_type = ?'); values.push(orgType); }
  if (regionCode !== undefined) { updates.push('region_code = ?'); values.push(regionCode); }
  if (addressLine1 !== undefined) { updates.push('address_line1 = ?'); values.push(addressLine1); }
  if (city !== undefined) { updates.push('city = ?'); values.push(city); }
  if (state !== undefined) { updates.push('state = ?'); values.push(state); }
  if (zip !== undefined) { updates.push('zip = ?'); values.push(zip); }
  if (country !== undefined) { updates.push('country = ?'); values.push(country); }
  if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
  if (settings !== undefined) { updates.push('settings = ?'); values.push(typeof settings === 'string' ? settings : JSON.stringify(settings)); }
  if (defaultStandard !== undefined) { updates.push('default_standard = ?'); values.push(defaultStandard); }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  values.push(user.orgId);

  await db.prepare(
    `UPDATE organisations SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Return updated org
  const org = await db.prepare(
    `SELECT id, name, org_type, region_code, address_line1, city, state, zip, country, phone, settings, default_standard
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  return c.json({
    organisation: {
      id: org!.id,
      name: org!.name,
      orgType: org!.org_type,
      regionCode: org!.region_code,
      addressLine1: org!.address_line1,
      city: org!.city,
      state: org!.state,
      zip: org!.zip,
      country: org!.country,
      phone: org!.phone,
      settings: org!.settings,
      defaultStandard: org!.default_standard,
    }
  });
});

// ── GET /api/org/profile — get current user's profile ───────────────────────
orgRoutes.get('/profile', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const row = await db.prepare(
    `SELECT id, email, first_name, last_name, phone, preferences
     FROM users WHERE id = ?`
  ).bind(user.id).first();

  if (!row) return c.json({ error: 'User not found' }, 404);

  return c.json({
    user: {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      preferences: row.preferences,
    }
  });
});

// ── PUT /api/org/profile — update current user's profile ────────────────────
orgRoutes.put('/profile', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const body = await c.req.json();
  const { firstName, lastName, phone, preferences } = body;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (firstName !== undefined) { updates.push('first_name = ?'); values.push(firstName); }
  if (lastName !== undefined) { updates.push('last_name = ?'); values.push(lastName); }
  if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
  if (preferences !== undefined) { updates.push('preferences = ?'); values.push(typeof preferences === 'string' ? preferences : JSON.stringify(preferences)); }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  values.push(user.id);

  await db.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Return updated profile
  const row = await db.prepare(
    `SELECT id, email, first_name, last_name, phone, preferences
     FROM users WHERE id = ?`
  ).bind(user.id).first();

  return c.json({
    user: {
      id: row!.id,
      email: row!.email,
      firstName: row!.first_name,
      lastName: row!.last_name,
      phone: row!.phone,
      preferences: row!.preferences,
    }
  });
});
