import { Hono } from 'hono';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
}

export const orgRoutes = new Hono<{ Bindings: Env }>();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Pull the lowercase domain off an email, or null if malformed. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

/** Generate a URL-safe random invite token. 24 bytes ≈ 32 base64url chars. */
function inviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── GET /api/org/authority — return the org's authority profile ───────────
// Returns null fields when not configured. Visible to any member of the
// org so the Settings page can decide whether to show the "Authority
// Profile" section. Mutating writes are admin-gated below.
orgRoutes.get('/authority', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const org = await db.prepare(
    `SELECT id, authority_type, authority_title,
            jurisdiction_states, jurisdiction_counties, jurisdiction_zips,
            authority_intake_notes, authority_intake_email
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);
  // Parse JSON arrays for the client.
  const parse = (v: unknown): string[] => {
    if (typeof v !== 'string' || !v) return [];
    try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; }
    catch { return []; }
  };
  return c.json({
    authority: {
      authorityType: org.authority_type ?? null,
      authorityTitle: org.authority_title ?? null,
      jurisdictionStates: parse(org.jurisdiction_states),
      jurisdictionCounties: parse(org.jurisdiction_counties),
      jurisdictionZips: parse(org.jurisdiction_zips),
      intakeNotes: org.authority_intake_notes ?? null,
      intakeEmail: org.authority_intake_email ?? null,
    },
  });
});

// ── PUT /api/org/authority — configure authority profile (admin-only) ─────
// Sets the org's authority_type + jurisdiction + intake metadata. Setting
// authority_type=null clears the profile. After this lands an admin still
// has to flip `is_permit_authority=1` on the relevant users (via /team
// or platform admin) before they can act on submissions.
orgRoutes.put('/authority', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can configure the authority profile' }, 403);
  }
  const body = await c.req.json();
  const validTypes = [
    'building_dept', 'fire_marshal', 'zoning', 'mechanical',
    'plumbing', 'electrical', 'environmental', 'general',
  ];
  const authorityType = body.authorityType ? String(body.authorityType) : null;
  if (authorityType && !validTypes.includes(authorityType)) {
    return c.json({ error: `authorityType must be one of: ${validTypes.join(', ')}` }, 400);
  }
  const stringifyList = (v: unknown): string | null => {
    if (!Array.isArray(v)) return null;
    const cleaned = v.map(String).map(s => s.trim()).filter(Boolean);
    return cleaned.length === 0 ? null : JSON.stringify(cleaned);
  };

  const before = await c.env.DB.prepare(
    `SELECT authority_type, authority_title, jurisdiction_states,
            jurisdiction_counties, jurisdiction_zips, authority_intake_notes,
            authority_intake_email
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  await c.env.DB.prepare(
    `UPDATE organisations
       SET authority_type = ?,
           authority_title = ?,
           jurisdiction_states = ?,
           jurisdiction_counties = ?,
           jurisdiction_zips = ?,
           authority_intake_notes = ?,
           authority_intake_email = ?
     WHERE id = ?`
  ).bind(
    authorityType,
    body.authorityTitle ? String(body.authorityTitle).slice(0, 120) : null,
    stringifyList(body.jurisdictionStates),
    stringifyList(body.jurisdictionCounties),
    stringifyList(body.jurisdictionZips),
    body.intakeNotes ? String(body.intakeNotes).slice(0, 5000) : null,
    body.intakeEmail ? String(body.intakeEmail).toLowerCase().trim().slice(0, 200) : null,
    user.orgId,
  ).run();

  setAudit(c, {
    action: authorityType ? 'org.authority.configure' : 'org.authority.clear',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: body.authorityTitle || null,
    beforeValue: before as Record<string, unknown>,
    afterValue: {
      authority_type: authorityType,
      authority_title: body.authorityTitle ?? null,
      jurisdiction_states: body.jurisdictionStates ?? null,
      jurisdiction_counties: body.jurisdictionCounties ?? null,
      jurisdiction_zips: body.jurisdictionZips ?? null,
      authority_intake_email: body.intakeEmail ?? null,
    },
  });

  return c.json({ ok: true });
});

// ── PATCH /api/org/users/:id/authority — toggle is_permit_authority flag ──
// Admin-only. Mirrors the role-change endpoint pattern.
orgRoutes.patch('/users/:id/authority', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can toggle authority status' }, 403);
  }
  const targetId = c.req.param('id');
  const body = await c.req.json();
  const flag = !!body.isPermitAuthority;

  const target = await c.env.DB.prepare(
    `SELECT email, is_permit_authority FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).first();

  const r = await c.env.DB.prepare(
    `UPDATE users SET is_permit_authority = ? WHERE id = ? AND org_id = ?`
  ).bind(flag ? 1 : 0, targetId, user.orgId).run();

  if (!r.meta.changes) return c.json({ error: 'Member not found' }, 404);

  setAudit(c, {
    action: flag ? 'user.authority.grant' : 'user.authority.revoke',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target?.email as string,
    beforeValue: { is_permit_authority: Number(target?.is_permit_authority ?? 0) === 1 },
    afterValue: { is_permit_authority: flag },
  });

  return c.json({ ok: true, isPermitAuthority: flag });
});

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

  const before = await db.prepare(
    `SELECT name, org_type, region_code, city, state, zip, country, phone, default_standard
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  values.push(user.orgId);

  await db.prepare(
    `UPDATE organisations SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Return updated org
  const org = await db.prepare(
    `SELECT id, name, org_type, region_code, address_line1, city, state, zip, country, phone, settings, default_standard
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  setAudit(c, {
    action: 'org.update',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: org!.name as string,
    beforeValue: before as Record<string, unknown>,
    afterValue: {
      name: org!.name,
      orgType: org!.org_type,
      regionCode: org!.region_code,
      city: org!.city,
      state: org!.state,
      defaultStandard: org!.default_standard,
    },
    detail: { fieldsChanged: Object.keys(body).filter((k) => body[k] !== undefined) },
  });

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

// ── GET /api/org/team — list members of caller's org + pending invites ─────
// Visible to every member of the tenant. Mutating endpoints below gate on
// role = 'admin'.
orgRoutes.get('/team', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const { results: members } = await db.prepare(
    `SELECT id, email, first_name, last_name, role,
            is_verified, is_permit_authority, last_seen_at, created_at
     FROM users
     WHERE org_id = ?
     ORDER BY created_at ASC`
  ).bind(user.orgId).all();

  const { results: invites } = await db.prepare(
    `SELECT id, invited_email, invited_role, status,
            invited_by, expires_at, created_at
     FROM org_invites
     WHERE org_id = ? AND status = 'pending'
       AND expires_at > datetime('now')
     ORDER BY created_at DESC`
  ).bind(user.orgId).all();

  const org = await db.prepare(
    `SELECT claimed_domain, domain_verified_at
     FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  return c.json({
    members,
    invites,
    domain: {
      claimed: org?.claimed_domain ?? null,
      verifiedAt: org?.domain_verified_at ?? null,
    },
  });
});

// ── PUT /api/org/domain — claim or update the org's email domain ────────────
// Admin-only. Setting a domain doesn't auto-verify; verifiedAt remains null
// until the future TXT-record flow lands. Two tenants cannot claim the same
// domain — the unique-active constraint is enforced in code (SQLite has no
// partial-unique without a migration we already use elsewhere).
orgRoutes.put('/domain', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can manage the org domain' }, 403);
  }

  const body = await c.req.json();
  const raw = (body.domain ?? '').toString().toLowerCase().trim();
  // Strip a leading "@" if the admin pasted the form they're used to typing.
  const domain = raw.startsWith('@') ? raw.slice(1) : raw;

  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return c.json({ error: 'Domain must look like example.com' }, 400);
  }

  if (domain) {
    const conflict = await c.env.DB.prepare(
      `SELECT id, name FROM organisations
       WHERE claimed_domain = ? AND id != ?`
    ).bind(domain, user.orgId).first();
    if (conflict) {
      return c.json({
        error: `Domain already claimed by another tenant. ` +
               `Contact platform admin to resolve.`,
      }, 409);
    }
  }

  const before = await c.env.DB.prepare(
    `SELECT claimed_domain FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();

  await c.env.DB.prepare(
    `UPDATE organisations
     SET claimed_domain = ?,
         domain_verified_at = NULL
     WHERE id = ?`
  ).bind(domain || null, user.orgId).run();

  setAudit(c, {
    action: domain ? 'org.domain.claim' : 'org.domain.clear',
    entityType: 'organisation',
    entityId: user.orgId,
    entityLabel: domain || (before?.claimed_domain as string) || null,
    beforeValue: { claimed_domain: before?.claimed_domain ?? null },
    afterValue: { claimed_domain: domain || null },
  });

  return c.json({ domain: domain || null, verifiedAt: null });
});

// ── POST /api/org/invite — invite a user by email ───────────────────────────
// Admin-only. Creates a pending invite record. Email delivery is Phase 2;
// for now the response includes the redemption token so the admin can copy
// the link out-of-band.
orgRoutes.post('/invite', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can invite users' }, 403);
  }

  const body = await c.req.json();
  const email = (body.email ?? '').toString().toLowerCase().trim();
  const role = (body.role ?? 'tech').toString();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }
  if (!['admin', 'engineer', 'tech', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Reject if email already belongs to a user (anywhere on the platform —
  // a user can only belong to one tenant).
  const existing = await c.env.DB.prepare(
    `SELECT id, org_id FROM users WHERE email = ?`
  ).bind(email).first();
  if (existing) {
    return c.json({
      error: existing.org_id === user.orgId
        ? 'This user is already a member of your organisation.'
        : 'This email is already registered with another organisation.',
    }, 409);
  }

  // Reject if there's already an active pending invite for this email
  // in this org — the admin can revoke first if they want a fresh one.
  const dup = await c.env.DB.prepare(
    `SELECT id FROM org_invites
     WHERE org_id = ? AND invited_email = ? AND status = 'pending'
       AND expires_at > datetime('now')`
  ).bind(user.orgId, email).first();
  if (dup) {
    return c.json({ error: 'An invite is already pending for this email.' }, 409);
  }

  const id = crypto.randomUUID();
  const token = inviteToken();
  // 14-day window mirrors the refresh-token rotation cadence in CLAUDE.md.
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO org_invites
       (id, org_id, invited_email, invited_role, invited_by, token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.orgId, email, role, user.id, token, expiresAt).run();

  setAudit(c, {
    action: 'org.invite.create',
    entityType: 'org_invite',
    entityId: id,
    entityLabel: email,
    detail: { invitedEmail: email, invitedRole: role, expiresAt },
  });

  return c.json({
    id,
    invitedEmail: email,
    invitedRole: role,
    token,           // Phase 2: drop from response once email delivery ships
    expiresAt,
  }, 201);
});

// ── DELETE /api/org/invites/:id — revoke a pending invite ───────────────────
orgRoutes.delete('/invites/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can revoke invites' }, 403);
  }
  const id = c.req.param('id');

  const before = await c.env.DB.prepare(
    `SELECT invited_email, invited_role FROM org_invites WHERE id = ? AND org_id = ?`
  ).bind(id, user.orgId).first();

  const r = await c.env.DB.prepare(
    `UPDATE org_invites
       SET status = 'revoked'
     WHERE id = ? AND org_id = ? AND status = 'pending'`
  ).bind(id, user.orgId).run();

  if (!r.meta.changes) return c.json({ error: 'Invite not found' }, 404);

  setAudit(c, {
    action: 'org.invite.revoke',
    entityType: 'org_invite',
    entityId: id,
    entityLabel: (before?.invited_email as string) ?? null,
    beforeValue: before as Record<string, unknown>,
  });

  return c.json({ ok: true });
});

// ── PATCH /api/org/users/:id — change a member's role ───────────────────────
orgRoutes.patch('/users/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can change roles' }, 403);
  }
  const targetId = c.req.param('id');
  const body = await c.req.json();
  const role = (body.role ?? '').toString();

  if (!['admin', 'engineer', 'tech', 'viewer'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Don't let the last admin demote themselves — every tenant must keep
  // at least one admin so the manage-team door stays open.
  if (targetId === user.id && role !== 'admin') {
    const { results: admins } = await c.env.DB.prepare(
      `SELECT id FROM users WHERE org_id = ? AND role = 'admin'`
    ).bind(user.orgId).all();
    if (admins.length <= 1) {
      return c.json({
        error: 'You are the last admin — promote someone else first.',
      }, 409);
    }
  }

  const target = await c.env.DB.prepare(
    `SELECT email, role FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).first();

  const r = await c.env.DB.prepare(
    `UPDATE users SET role = ? WHERE id = ? AND org_id = ?`
  ).bind(role, targetId, user.orgId).run();

  if (!r.meta.changes) return c.json({ error: 'Member not found' }, 404);

  setAudit(c, {
    action: 'user.role_changed',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target?.email as string,
    beforeValue: { role: target?.role },
    afterValue: { role },
    detail: { selfDemotion: targetId === user.id },
  });

  return c.json({ ok: true, role });
});

// ── DELETE /api/org/users/:id — remove a member from the tenant ─────────────
// Soft semantics for now: we hard-delete the user row because there are no
// auditing dependencies yet. When audit_log is wired we'll switch to
// status = 'removed' instead.
orgRoutes.delete('/users/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can remove members' }, 403);
  }
  const targetId = c.req.param('id');

  if (targetId === user.id) {
    return c.json({ error: 'You cannot remove yourself.' }, 400);
  }

  const target = await c.env.DB.prepare(
    `SELECT email, role, first_name, last_name FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).first();

  const r = await c.env.DB.prepare(
    `DELETE FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).run();

  if (!r.meta.changes) return c.json({ error: 'Member not found' }, 404);

  setAudit(c, {
    action: 'user.remove',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target?.email as string,
    beforeValue: target as Record<string, unknown>,
  });

  return c.json({ ok: true });
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

  const before = await db.prepare(
    `SELECT first_name, last_name, phone FROM users WHERE id = ?`
  ).bind(user.id).first();

  values.push(user.id);

  await db.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  setAudit(c, {
    action: 'user.profile.update',
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.email,
    beforeValue: before as Record<string, unknown>,
    afterValue: { firstName, lastName, phone, preferencesUpdated: preferences !== undefined },
  });

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
