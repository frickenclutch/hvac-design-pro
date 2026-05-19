import { Hono } from 'hono';
import { setAudit } from '../middleware/audit';
import { sendEmail, buildInviteEmail } from '../utils/email';
import { computeRoleChangePlan } from '../utils/roleChange';
import {
  resolveAccessPolicy,
  sanitizeAccessPolicyPatch,
  mergeAccessPolicyIntoSettings,
  capabilitiesFor,
} from '../utils/accessPolicy';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  /** Override the From: address on outbound invitations.
   *  Falls back to FEEDBACK_FROM_ADDRESS, then DEFAULT_FROM_ADDRESS in email.ts. */
  INVITE_FROM_ADDRESS?: string;
  FEEDBACK_FROM_ADDRESS?: string;
  /** Public URL of the frontend — used to build the redemption link.
   *  Defaults to the production Pages URL. */
  FRONTEND_BASE_URL?: string;
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

// ── GET /api/org/access-policy ──────────────────────────────────────────────
// Any authenticated member can READ the resolved policy — the frontend
// needs the caller's capabilities to gate UI. Returns the raw thresholds,
// the caller's concrete yes/no capabilities, and whether the caller may
// edit the policy (tenant admin or L0).
orgRoutes.get('/access-policy', async (c) => {
  const user = c.get('user');
  const org = await c.env.DB.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const policy = resolveAccessPolicy(org.settings);
  const capabilities = capabilitiesFor(
    { role: user.role, isPlatformAdmin: user.isPlatformAdmin },
    policy,
  );
  return c.json({ policy, capabilities });
});

// ── PUT /api/org/access-policy ──────────────────────────────────────────────
// Tenant admin OR L0 sets the org's policy. Partial — only the keys in
// the body change; others keep their current resolved value. Other
// settings JSON keys are preserved.
orgRoutes.put('/access-policy', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !user.isPlatformAdmin) {
    return c.json({ error: 'Only the tenant admin or platform owner can change the access policy' }, 403);
  }

  const body = await c.req.json();
  const patch = sanitizeAccessPolicyPatch(body);
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No valid policy fields. Expected one of: versionView, versionRestore, auditView with a role value (viewer|tech|engineer|admin).' }, 400);
  }

  const org = await c.env.DB.prepare(
    `SELECT settings FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  if (!org) return c.json({ error: 'Organisation not found' }, 404);

  const before = resolveAccessPolicy(org.settings);
  const next = { ...before, ...patch };
  const mergedSettings = mergeAccessPolicyIntoSettings(org.settings, next);

  await c.env.DB.prepare(
    `UPDATE organisations SET settings = ? WHERE id = ?`
  ).bind(mergedSettings, user.orgId).run();

  setAudit(c, {
    action: 'org.access_policy.update',
    entityType: 'organisation',
    entityId: user.orgId,
    beforeValue: before as unknown as Record<string, unknown>,
    afterValue: next as unknown as Record<string, unknown>,
    detail: { fieldsChanged: Object.keys(patch) },
  });

  const capabilities = capabilitiesFor(
    { role: user.role, isPlatformAdmin: user.isPlatformAdmin },
    next,
  );
  return c.json({ policy: next, capabilities });
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
            is_verified, is_permit_authority, last_seen_at, created_at, status
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

  // Pull org name + inviter name for the email body. Both are denormalized
  // into the email so the recipient can verify the invite is from someone
  // they expect before clicking through.
  const orgRow = await c.env.DB.prepare(
    `SELECT name FROM organisations WHERE id = ?`
  ).bind(user.orgId).first();
  const inviterRow = await c.env.DB.prepare(
    `SELECT first_name, last_name, email FROM users WHERE id = ?`
  ).bind(user.id).first();

  const inviterName = [
    inviterRow?.first_name as string | undefined,
    inviterRow?.last_name as string | undefined,
  ].filter(Boolean).join(' ').trim() || (inviterRow?.email as string) || 'A teammate';
  const inviterEmail = (inviterRow?.email as string) || '';
  const orgName = (orgRow?.name as string) || 'their workspace';

  // Where the redemption link points. The path resolves to OnboardingPage,
  // which detects the ?invite query param and walks the new user through
  // password setup before calling /api/auth/invite/:token/redeem.
  const frontendBase = c.env.FRONTEND_BASE_URL || 'https://hvac-design-pro.pages.dev';
  const redeemUrl = `${frontendBase}/onboarding?invite=${encodeURIComponent(token)}`;

  // Send the email. waitUntil keeps the response fast — the API call
  // returns immediately even if Resend is slow / down.
  const inviteEmail = buildInviteEmail({
    orgName,
    inviterName,
    inviterEmail,
    invitedRole: role,
    redeemUrl,
    expiresAt,
  });
  inviteEmail.to = email;
  const fromAddress = c.env.INVITE_FROM_ADDRESS || c.env.FEEDBACK_FROM_ADDRESS;
  if (fromAddress) inviteEmail.from = fromAddress;

  // Track delivery outcome so we can surface "email sent / failed" in the
  // invite list. Awaited only to capture the result for the API response;
  // the audit row gets the truth either way.
  let emailResult: Awaited<ReturnType<typeof sendEmail>> | null = null;
  try {
    emailResult = await sendEmail(c.env.RESEND_API_KEY, inviteEmail);
  } catch (err) {
    console.error('[org.invite] email send threw:', err);
  }

  setAudit(c, {
    action: 'org.invite.create',
    entityType: 'org_invite',
    entityId: id,
    entityLabel: email,
    detail: {
      invitedEmail: email,
      invitedRole: role,
      expiresAt,
      emailSent: emailResult?.ok === true,
      emailStatus: emailResult?.status ?? null,
      emailError: emailResult?.error ?? null,
    },
  });

  return c.json({
    id,
    invitedEmail: email,
    invitedRole: role,
    // Token still returned so admins can copy the link out-of-band when
    // email delivery is unreliable (corporate filters, etc).
    token,
    expiresAt,
    redeemUrl,
    emailSent: emailResult?.ok === true,
    emailError: emailResult?.ok ? null : (emailResult?.error ?? 'Email delivery is not configured'),
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

// ── POST /api/org/users/:id/role-change/preflight ───────────────────────────
// Advisory: compute the blast radius of a proposed role change /
// deactivation so the UI can force gap-resolution before commit. Pass
// { role } for a role change, or { role: null } / omit for deactivation.
orgRoutes.post('/users/:id/role-change/preflight', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can change roles' }, 403);
  }
  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const proposedRole = body.role === undefined ? null
    : (body.role === null ? null : String(body.role));
  if (proposedRole !== null && !['admin', 'engineer', 'tech', 'viewer'].includes(proposedRole)) {
    return c.json({ error: 'Invalid role' }, 400);
  }
  const plan = await computeRoleChangePlan(c.env.DB, {
    orgId: user.orgId, targetUserId: targetId, proposedRole,
  });
  if (!plan) return c.json({ error: 'Member not found' }, 404);
  return c.json(plan);
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

  // Generalized continuity guard (replaces the old self-demote-only
  // check): the commit endpoint independently re-runs the consequence
  // engine and 409s on any 'block'-severity item, so a hand-rolled
  // request can't bypass the UI checklist. Covers sole-admin for ANY
  // target, not just self.
  const plan = await computeRoleChangePlan(c.env.DB, {
    orgId: user.orgId, targetUserId: targetId, proposedRole: role,
  });
  if (!plan) return c.json({ error: 'Member not found' }, 404);
  if (!plan.clear) {
    return c.json({
      error: 'Resolve the blocking consequences before this role change.',
      blockers: plan.blockers.filter((b) => b.severity === 'block'),
    }, 409);
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

// ── DELETE /api/org/users/:id — soft-deactivate a member ───────────────────
// NON-DESTRUCTIVE (changed 2026-05-15). Previously hard-deleted the row,
// which silently orphaned projects.created_by / cad_drawings.created_by /
// calculations.computed_by (D1 doesn't enforce FKs). Now: set
// status='deactivated', purge the user's sessions so any live token dies
// immediately, and KEEP the row + all attribution intact. The user can
// be reactivated (PATCH /users/:id/reactivate) — rotation is reversible.
orgRoutes.delete('/users/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can remove members' }, 403);
  }
  const targetId = c.req.param('id');

  if (targetId === user.id) {
    return c.json({ error: 'You cannot remove yourself.' }, 400);
  }

  // Continuity guard for deactivation (proposedRole=null). 409s on
  // sole-admin / sole-permit-authority so a tenant can't be stranded.
  const plan = await computeRoleChangePlan(c.env.DB, {
    orgId: user.orgId, targetUserId: targetId, proposedRole: null,
  });
  if (!plan) return c.json({ error: 'Member not found' }, 404);
  if (!plan.clear) {
    return c.json({
      error: 'Resolve the blocking consequences before deactivating this member.',
      blockers: plan.blockers.filter((b) => b.severity === 'block'),
    }, 409);
  }

  const target = await c.env.DB.prepare(
    `SELECT email, role, first_name, last_name, status FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).first();
  if (!target) return c.json({ error: 'Member not found' }, 404);

  const r = await c.env.DB.prepare(
    `UPDATE users SET status = 'deactivated' WHERE id = ? AND org_id = ? AND status = 'active'`
  ).bind(targetId, user.orgId).run();
  if (!r.meta.changes) {
    return c.json({ error: 'Member not found or already deactivated' }, 404);
  }

  // Kill live sessions so the deactivation takes effect now, not at the
  // 30-day token expiry (the JML "logged-in user keeps access" gotcha).
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetId).run();

  setAudit(c, {
    action: 'user.deactivate',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target.email as string,
    beforeValue: { status: 'active', role: target.role },
    afterValue: { status: 'deactivated' },
    detail: { sessionsPurged: true },
  });

  return c.json({ ok: true, status: 'deactivated' });
});

// ── POST /api/org/users/:id/reactivate — reverse a deactivation ────────────
// Rotation must be reversible without disruption — a misclick deactivation
// is recoverable from the UI, not just raw SQL.
orgRoutes.post('/users/:id/reactivate', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Only admins can reactivate members' }, 403);
  }
  const targetId = c.req.param('id');

  const target = await c.env.DB.prepare(
    `SELECT email, role, status FROM users WHERE id = ? AND org_id = ?`
  ).bind(targetId, user.orgId).first();
  if (!target) return c.json({ error: 'Member not found' }, 404);

  const r = await c.env.DB.prepare(
    `UPDATE users SET status = 'active' WHERE id = ? AND org_id = ? AND status = 'deactivated'`
  ).bind(targetId, user.orgId).run();
  if (!r.meta.changes) {
    return c.json({ error: 'Member not found or already active' }, 404);
  }

  setAudit(c, {
    action: 'user.reactivate',
    entityType: 'user',
    entityId: targetId,
    entityLabel: target.email as string,
    beforeValue: { status: 'deactivated' },
    afterValue: { status: 'active' },
  });

  return c.json({ ok: true, status: 'active' });
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
