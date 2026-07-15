import { Hono } from 'hono';
import { generateId, uniqueOrgSlug } from '../utils/id';
import { hashPassword, verifyPassword, isLegacyHash, hashToken } from '../utils/crypto';
import { mintTokenPair } from '../utils/session';
import { nowIso } from '../utils/time';
import { sendEmail, buildWelcomeEmail, buildVerificationEmail, buildPasswordResetEmail, buildMfaEmailCode } from '../utils/email';
import { createVerificationCode, validateVerificationCode } from '../utils/verificationCodes';
import { checkRateLimit, recordRateLimitEvent, cleanupRateLimitEvents } from '../utils/rateLimit';
import { buildAuthUrl, exchangeCodeForTokens, fetchMicrosoftProfile, buildCfAccessAuthUrl, exchangeCfAccessCode, fetchCfAccessUserInfo } from '../utils/oauth';
import { writeAuthAudit } from '../middleware/audit';
import { authMiddleware, type AuthUser } from '../middleware/auth';
import {
  randomBase32Secret, buildOtpauthUri, verifyTotp,
  encryptSecret, decryptSecret, isMfaKeyConfigured,
  generateBackupCodes, newChallengeToken,
} from '../utils/mfa';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  RESEND_API_KEY?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  CF_ACCESS_ISSUER?: string;
  ENVIRONMENT?: string;
  MFA_ENC_KEY?: string;
}

export const authRoutes = new Hono<{ Bindings: Env }>();

// ── MFA helpers (shared by login + the /mfa/* endpoints) ─────────────────────

const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Has this user a CONFIRMED (active) TOTP credential? */
async function isMfaEnrolled(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT confirmed_at FROM mfa_credentials WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NOT NULL`,
  ).bind(userId).first();
  return !!row;
}

/** Role policy: MFA is REQUIRED for tenant admins and L0 platform admins. */
function mfaRequiredFor(role: unknown, isPlatformAdmin: unknown): boolean {
  return role === 'admin' || Number(isPlatformAdmin ?? 0) === 1;
}

/** Create a single-use login/enroll challenge bound to a user; returns the RAW
 *  token (hashed at rest). The raw token is the only thing that lets the
 *  second-factor (or grace-enroll) step proceed — a client cannot forge it. */
async function createMfaChallenge(
  db: D1Database,
  userId: string,
  orgId: string,
  purpose: 'login' | 'enroll',
): Promise<string> {
  const raw = newChallengeToken();
  await db.prepare(
    `INSERT INTO mfa_challenges (id, user_id, org_id, token_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    generateId(), userId, orgId, await hashToken(raw), purpose,
    new Date(Date.now() + MFA_CHALLENGE_TTL_MS).toISOString(),
  ).run();
  return raw;
}

interface ChallengeRow {
  id: string;
  user_id: string;
  org_id: string;
}

/** Resolve a live (unconsumed, unexpired) challenge by raw token + purpose.
 *  Does NOT consume it — callers consume only on a fully-successful step. */
async function loadMfaChallenge(
  db: D1Database,
  rawToken: string,
  purpose: 'login' | 'enroll',
): Promise<ChallengeRow | null> {
  const hash = await hashToken(rawToken);
  // Bound ISO now, not datetime('now') — expires_at is ISO (utils/time.ts).
  const row = await db.prepare(
    `SELECT id, user_id, org_id FROM mfa_challenges
     WHERE token_hash = ? AND purpose = ?
       AND consumed_at IS NULL AND expires_at > ?`,
  ).bind(hash, purpose, nowIso()).first<ChallengeRow>();
  return row ?? null;
}

/** The exact login success payload shape, rebuilt from a user id (used by the
 *  challenge + grace-confirm endpoints after the factor passes). Returns null
 *  if the user is missing or no longer active. */
async function buildSessionResponse(
  db: D1Database, userId: string,
): Promise<{ token: string; refreshToken: string; body: Record<string, unknown> } | null> {
  const u = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_platform_admin, u.is_permit_authority, u.org_id, u.status,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ?`,
  ).bind(userId).first();
  if (!u || (u.status as string) !== 'active') return null;

  const { accessToken: token, refreshToken } = await mintTokenPair(db, u.id as string, u.org_id as string);
  return {
    token,
    refreshToken,
    body: {
      token,
      refreshToken,
      user: {
        id: u.id, email: u.email, firstName: u.first_name,
        lastName: u.last_name, role: u.role, isVerified: true,
        isPlatformAdmin: Number(u.is_platform_admin ?? 0) === 1,
        isPermitAuthority: Number(u.is_permit_authority ?? 0) === 1,
      },
      organisation: {
        id: u.org_id, name: u.org_name, type: u.org_type,
        slug: u.slug, regionCode: u.region_code,
      },
    },
  };
}

// ── Register new user + org ──────────────────────────────────────────────────
authRoutes.post('/register', async (c) => {
  const body = await c.req.json();
  const { email, password, firstName, lastName, orgName, orgType, regionCode,
          addressLine1, city, state, zip, country, phone } = body;

  if (!email || !password || !firstName || !lastName) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit registration
  const limit = await checkRateLimit(db, normalizedEmail, 'register', 5, 15);
  if (!limit.allowed) {
    return c.json({ error: `Too many registration attempts. Try again in ${Math.ceil(limit.retryAfterSeconds! / 60)} minutes.` }, 429);
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(normalizedEmail).first();
  if (existing) {
    await recordRateLimitEvent(db, normalizedEmail, 'register');
    return c.json({ error: 'Email already registered' }, 409);
  }

  const orgId = generateId();
  const userId = generateId();
  const slug = await uniqueOrgSlug(db, orgName || `${firstName}-${lastName}`);

  const passwordHash = await hashPassword(password);

  // Create org + user — is_verified = 0 (pending email verification)
  const batch = [
    db.prepare(
      `INSERT INTO organisations (id, slug, name, org_type, region_code, address_line1, city, state, zip, country, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(orgId, slug, orgName || `${firstName}'s Workspace`, orgType || 'individual', regionCode || 'NA_ASHRAE',
           addressLine1 || null, city || null, state || null, zip || null, country || 'US', phone || null),

    db.prepare(
      `INSERT INTO users (id, org_id, email, password_hash, role, first_name, last_name, is_verified)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, 0)`
    ).bind(userId, orgId, normalizedEmail, passwordHash, firstName, lastName),
  ];

  await db.batch(batch);

  // Generate verification code and send email
  const code = await createVerificationCode(db, userId, normalizedEmail, 'email_verification');
  const verifyEmail = buildVerificationEmail(firstName, code);
  verifyEmail.to = normalizedEmail;
  c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, verifyEmail));

  // Cleanup old rate limit events in the background
  c.executionCtx.waitUntil(cleanupRateLimitEvents(db));

  await writeAuthAudit(c, {
    action: 'auth.register', status: 201,
    userId, orgId,
    actorRole: 'admin', entityId: userId,
    entityLabel: normalizedEmail,
    detail: { orgName: orgName || `${firstName}'s Workspace`, orgType: orgType || 'individual' },
  });

  return c.json({ pendingVerification: true, email: normalizedEmail }, 201);
});

// ── Login ────────────────────────────────────────────────────────────────────
authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const limit = await checkRateLimit(db, normalizedEmail, 'login', 5, 15);
  if (!limit.allowed) {
    return c.json({
      error: `Too many login attempts. Try again in ${Math.ceil(limit.retryAfterSeconds! / 60)} minutes.`,
      retryAfterSeconds: limit.retryAfterSeconds,
    }, 429);
  }

  const user = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.is_permit_authority, u.org_id,
            u.password_hash, u.status,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(normalizedEmail).first();

  if (!user || !user.password_hash) {
    await recordRateLimitEvent(db, normalizedEmail, 'login');
    await writeAuthAudit(c, {
      action: 'auth.login.failed', status: 401,
      entityLabel: normalizedEmail,
      detail: { reason: 'unknown_email_or_no_password', email: normalizedEmail },
    });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash as string);
  if (!valid) {
    await recordRateLimitEvent(db, normalizedEmail, 'login');
    await writeAuthAudit(c, {
      action: 'auth.login.failed', status: 401,
      userId: user.id as string, orgId: user.org_id as string,
      actorRole: user.role as string, entityId: user.id as string,
      entityLabel: normalizedEmail,
      detail: { reason: 'bad_password' },
    });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Deactivated account: password was correct (so we're not leaking
  // anything to a guesser), but the account is soft-deactivated. Reject
  // session mint with a clear, distinct message + audit it.
  if ((user.status as string) !== 'active') {
    await writeAuthAudit(c, {
      action: 'auth.login.deactivated', status: 403,
      userId: user.id as string, orgId: user.org_id as string,
      actorRole: user.role as string, entityId: user.id as string,
      entityLabel: normalizedEmail,
      detail: { status: user.status },
    });
    return c.json({
      error: 'This account has been deactivated. Contact your organisation admin.',
      deactivated: true,
    }, 403);
  }

  // If using legacy hash, upgrade to PBKDF2 transparently
  if (isLegacyHash(user.password_hash as string)) {
    const upgraded = await hashPassword(password);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(upgraded, user.id).run();
  }

  // Check if email is verified
  if (!user.is_verified) {
    // Resend verification code
    const code = await createVerificationCode(db, user.id as string, normalizedEmail, 'email_verification');
    const verifyEmailMsg = buildVerificationEmail(user.first_name as string, code);
    verifyEmailMsg.to = normalizedEmail;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, verifyEmailMsg));

    return c.json({
      error: 'Please verify your email address first. A new verification code has been sent.',
      pendingVerification: true,
      email: normalizedEmail,
    }, 403);
  }

  // ── MFA second-factor gate ──────────────────────────────────────────────
  // Password is correct + account active + email verified. Before minting a
  // session we branch on the user's MFA state. A non-MFA, non-required user
  // (the overwhelming majority today) falls straight through — byte-identical
  // to the prior behavior. See the state machine in CLAUDE.md / the MFA design.
  {
    const enrolled = await isMfaEnrolled(db, user.id as string);
    const required = mfaRequiredFor(user.role, user.is_platform_admin);

    if (enrolled) {
      // NEVER mint on password alone — issue a single-use login challenge.
      const raw = await createMfaChallenge(db, user.id as string, user.org_id as string, 'login');
      await writeAuthAudit(c, {
        action: 'auth.mfa.challenge_started', status: 202,
        userId: user.id as string, orgId: user.org_id as string,
        actorRole: user.role as string, entityId: user.id as string,
        entityLabel: user.email as string,
        detail: { method: 'password' },
      });
      return c.json({
        mfaRequired: true,
        mfaChallengeToken: raw,
        methods: ['totp', 'email', 'backup'],
        email: user.email,
      }, 202);
    }

    if (required) {
      // Required-but-not-enrolled: DO NOT hard-fail (no admin lockout) and DO
      // NOT mint a session. Hand back a grace-enroll challenge that forces
      // enrollment in-flow.
      const raw = await createMfaChallenge(db, user.id as string, user.org_id as string, 'enroll');
      await writeAuthAudit(c, {
        action: 'auth.mfa.enrollment_required', status: 403,
        userId: user.id as string, orgId: user.org_id as string,
        actorRole: user.role as string, entityId: user.id as string,
        entityLabel: user.email as string,
        detail: { method: 'password' },
      });
      return c.json({
        enrollmentRequired: true,
        mfaEnrollToken: raw,
        email: user.email,
        message: 'Your role requires multi-factor authentication. Set it up to continue.',
      }, 403);
    }
  }

  // Create session
  const { accessToken: token, refreshToken } = await mintTokenPair(db, user.id as string, user.org_id as string);

  await writeAuthAudit(c, {
    action: 'auth.login', status: 200,
    userId: user.id as string, orgId: user.org_id as string,
    actorRole: user.role as string, entityId: user.id as string,
    entityLabel: user.email as string,
    detail: { method: 'password' },
  });

  return c.json({
    token,
    refreshToken,
    user: {
      id: user.id, email: user.email, firstName: user.first_name,
      lastName: user.last_name, role: user.role, isVerified: true,
      isPlatformAdmin: Number(user.is_platform_admin ?? 0) === 1,
      isPermitAuthority: Number(user.is_permit_authority ?? 0) === 1,
    },
    organisation: {
      id: user.org_id, name: user.org_name, type: user.org_type,
      slug: user.slug, regionCode: user.region_code
    }
  });
});

// ── Verify Email ────────────────────────────────────────────────────────────
authRoutes.post('/verify-email', async (c) => {
  const { email, code } = await c.req.json();
  if (!email || !code) return c.json({ error: 'Email and code are required' }, 400);

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const limit = await checkRateLimit(db, normalizedEmail, 'verify', 5, 15);
  if (!limit.allowed) {
    return c.json({ error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds! / 60)} minutes.` }, 429);
  }

  const result = await validateVerificationCode(db, normalizedEmail, code, 'email_verification');

  if (!result.valid) {
    await recordRateLimitEvent(db, normalizedEmail, 'verify');
    return c.json({ error: result.error }, 400);
  }

  // Mark user as verified and create session in a batch
  await db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').bind(result.userId).run();

  // Fetch full user + org data for the response
  const userData = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_platform_admin, u.is_permit_authority, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ?`
  ).bind(result.userId).first();

  if (!userData) return c.json({ error: 'User not found' }, 500);

  const { accessToken: token, refreshToken } = await mintTokenPair(db, userData.id as string, userData.org_id as string);

  await writeAuthAudit(c, {
    action: 'auth.email_verified', status: 200,
    userId: userData.id as string, orgId: userData.org_id as string,
    actorRole: userData.role as string, entityId: userData.id as string,
    entityLabel: userData.email as string,
  });

  // Send welcome email (fire-and-forget)
  const welcomeEmail = buildWelcomeEmail(userData.first_name as string);
  welcomeEmail.to = normalizedEmail;
  c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, welcomeEmail));

  return c.json({
    token,
    refreshToken,
    user: {
      id: userData.id, email: userData.email, firstName: userData.first_name,
      lastName: userData.last_name, role: userData.role, isVerified: true,
      isPlatformAdmin: Number(userData.is_platform_admin ?? 0) === 1,
      isPermitAuthority: Number(userData.is_permit_authority ?? 0) === 1,
    },
    organisation: {
      id: userData.org_id, name: userData.org_name, type: userData.org_type,
      slug: userData.slug, regionCode: userData.region_code
    }
  });
});

// ── Resend Verification Code ────────────────────────────────────────────────
authRoutes.post('/resend-verification', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: 'Email is required' }, 400);

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const limit = await checkRateLimit(db, normalizedEmail, 'resend_code', 3, 5);
  if (!limit.allowed) {
    return c.json({ error: `Please wait before requesting another code.`, retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  await recordRateLimitEvent(db, normalizedEmail, 'resend_code');

  // Look up user — always return ok to prevent email enumeration
  const user = await db.prepare(
    'SELECT id, first_name, is_verified FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (user && !user.is_verified) {
    const code = await createVerificationCode(db, user.id as string, normalizedEmail, 'email_verification');
    const verifyEmailMsg = buildVerificationEmail(user.first_name as string, code);
    verifyEmailMsg.to = normalizedEmail;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, verifyEmailMsg));
  }

  return c.json({ ok: true });
});

// ── Forgot Password ─────────────────────────────────────────────────────────
authRoutes.post('/forgot-password', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: 'Email is required' }, 400);

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const limit = await checkRateLimit(db, normalizedEmail, 'forgot_password', 3, 15);
  if (!limit.allowed) {
    return c.json({ error: `Too many requests. Try again in ${Math.ceil(limit.retryAfterSeconds! / 60)} minutes.` }, 429);
  }

  await recordRateLimitEvent(db, normalizedEmail, 'forgot_password');

  // Look up user — always return ok to prevent email enumeration
  const user = await db.prepare(
    'SELECT id, first_name FROM users WHERE email = ?'
  ).bind(normalizedEmail).first();

  if (user) {
    const code = await createVerificationCode(db, user.id as string, normalizedEmail, 'password_reset');
    const resetEmail = buildPasswordResetEmail(user.first_name as string, code);
    resetEmail.to = normalizedEmail;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, resetEmail));
  }

  return c.json({ ok: true });
});

// ── Reset Password ──────────────────────────────────────────────────────────
authRoutes.post('/reset-password', async (c) => {
  const { email, code, newPassword } = await c.req.json();
  if (!email || !code || !newPassword) {
    return c.json({ error: 'Email, code, and new password are required' }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const db = c.env.DB;
  const normalizedEmail = email.toLowerCase().trim();

  // Rate limiting
  const limit = await checkRateLimit(db, normalizedEmail, 'verify', 5, 15);
  if (!limit.allowed) {
    return c.json({ error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds! / 60)} minutes.` }, 429);
  }

  const result = await validateVerificationCode(db, normalizedEmail, code, 'password_reset');

  if (!result.valid) {
    await recordRateLimitEvent(db, normalizedEmail, 'verify');
    return c.json({ error: result.error }, 400);
  }

  // Hash new password and invalidate all sessions
  const passwordHash = await hashPassword(newPassword);

  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, result.userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(result.userId),
    // A password reset means "kill all my credentials" — and the user stays
    // active, so the /refresh status gate won't catch a stolen refresh token.
    // Revoke them here explicitly.
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(result.userId),
  ]);

  await writeAuthAudit(c, {
    action: 'auth.password_reset', status: 200,
    userId: result.userId as string,
    entityId: result.userId as string,
    entityLabel: normalizedEmail,
    detail: { allSessionsInvalidated: true },
  });

  return c.json({ ok: true });
});

// ── SSO: Microsoft — Get Auth URL ───────────────────────────────────────────
authRoutes.get('/sso/microsoft/url', async (c) => {
  const clientId = c.env.AZURE_CLIENT_ID;
  if (!clientId) return c.json({ error: 'Microsoft SSO is not configured' }, 501);

  const state = generateId();
  const isDev = c.env.ENVIRONMENT === 'development';
  const url = buildAuthUrl(clientId, state, isDev);

  return c.json({ url, state });
});

// ── SSO: Microsoft — Exchange Code ──────────────────────────────────────────
authRoutes.post('/sso/microsoft/callback', async (c) => {
  const { code } = await c.req.json();
  if (!code) return c.json({ error: 'Authorization code is required' }, 400);

  const clientId = c.env.AZURE_CLIENT_ID;
  const clientSecret = c.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'Microsoft SSO is not configured' }, 501);

  const db = c.env.DB;
  const isDev = c.env.ENVIRONMENT === 'development';

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(clientId, clientSecret, code, isDev);
  } catch (err) {
    console.error('[sso] Token exchange error:', err);
    return c.json({ error: 'Failed to authenticate with Microsoft. Please try again.' }, 400);
  }

  // Fetch user profile from Microsoft Graph
  let profile;
  try {
    profile = await fetchMicrosoftProfile(tokens.access_token);
  } catch (err) {
    console.error('[sso] Graph API error:', err);
    return c.json({ error: 'Failed to fetch Microsoft profile.' }, 400);
  }

  // Microsoft Graph: mail may be null for personal accounts, fall back to userPrincipalName
  const email = (profile.mail || profile.userPrincipalName || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return c.json({ error: 'Could not determine email from Microsoft account.' }, 400);
  }

  const firstName = profile.givenName || profile.displayName?.split(' ')[0] || 'User';
  const surname = profile.surname || profile.displayName?.split(' ').slice(1).join(' ') || '';

  // Check if user already exists
  const existingUser = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.is_permit_authority, u.org_id, u.status,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(email).first();

  // SSO must not resurrect a deactivated account.
  if (existingUser && (existingUser.status as string) !== 'active') {
    await writeAuthAudit(c, {
      action: 'auth.login.deactivated', status: 403,
      userId: existingUser.id as string, orgId: existingUser.org_id as string,
      actorRole: existingUser.role as string, entityId: existingUser.id as string,
      entityLabel: email,
      detail: { status: existingUser.status, method: 'sso_microsoft' },
    });
    return c.json({
      error: 'This account has been deactivated. Contact your organisation admin.',
      deactivated: true,
    }, 403);
  }

  let userId: string;
  let orgId: string;
  let userRole: string;
  let userFirstName: string;
  let userLastName: string;
  let orgName: string;
  let orgType: string;
  let orgSlug: string;
  let regionCode: string;
  let isPlatformAdmin = false;
  let isPermitAuthority = false;

  if (existingUser) {
    // Existing user — link SSO (mark verified if not already)
    userId = existingUser.id as string;
    orgId = existingUser.org_id as string;
    userRole = existingUser.role as string;
    userFirstName = existingUser.first_name as string;
    userLastName = existingUser.last_name as string;
    orgName = existingUser.org_name as string;
    orgType = existingUser.org_type as string;
    orgSlug = existingUser.slug as string;
    regionCode = existingUser.region_code as string;
    isPlatformAdmin = Number(existingUser.is_platform_admin ?? 0) === 1;
    isPermitAuthority = Number(existingUser.is_permit_authority ?? 0) === 1;

    if (!existingUser.is_verified) {
      await db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').bind(userId).run();
    }
  } else {
    // New user via SSO — create org + user (no password, pre-verified)
    orgId = generateId();
    userId = generateId();
    const slug = await uniqueOrgSlug(db, `${firstName}-${surname}`);

    await db.batch([
      db.prepare(
        `INSERT INTO organisations (id, slug, name, org_type, region_code)
         VALUES (?, ?, ?, 'individual', 'NA_ASHRAE')`
      ).bind(orgId, slug, `${firstName}'s Workspace`),

      db.prepare(
        `INSERT INTO users (id, org_id, email, role, first_name, last_name, is_verified)
         VALUES (?, ?, ?, 'admin', ?, ?, 1)`
      ).bind(userId, orgId, email, firstName, surname),
    ]);

    userRole = 'admin';
    userFirstName = firstName;
    userLastName = surname;
    orgName = `${firstName}'s Workspace`;
    orgType = 'individual';
    orgSlug = slug;
    regionCode = 'NA_ASHRAE';

    // Send welcome email
    const welcomeEmail = buildWelcomeEmail(firstName);
    welcomeEmail.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, welcomeEmail));
  }

  // ── MFA second-factor gate (returning SSO user) ─────────────────────────
  // A freshly-created SSO user has no credential row, so isMfaEnrolled is
  // false and (if their role isn't required) they fall straight through —
  // unchanged. A returning enrolled user is challenged; a required-but-not-
  // enrolled user gets the grace-enroll handoff.
  {
    const enrolled = await isMfaEnrolled(db, userId);
    const required = mfaRequiredFor(userRole, isPlatformAdmin);
    if (enrolled) {
      const raw = await createMfaChallenge(db, userId, orgId, 'login');
      await writeAuthAudit(c, {
        action: 'auth.mfa.challenge_started', status: 202,
        userId, orgId, actorRole: userRole, entityId: userId,
        entityLabel: email, detail: { method: 'sso_microsoft' },
      });
      return c.json({ mfaRequired: true, mfaChallengeToken: raw, methods: ['totp', 'email', 'backup'], email }, 202);
    }
    if (required) {
      const raw = await createMfaChallenge(db, userId, orgId, 'enroll');
      await writeAuthAudit(c, {
        action: 'auth.mfa.enrollment_required', status: 403,
        userId, orgId, actorRole: userRole, entityId: userId,
        entityLabel: email, detail: { method: 'sso_microsoft' },
      });
      return c.json({
        enrollmentRequired: true, mfaEnrollToken: raw, email,
        message: 'Your role requires multi-factor authentication. Set it up to continue.',
      }, 403);
    }
  }

  // Create session
  const { accessToken: token, refreshToken } = await mintTokenPair(db, userId, orgId);

  await writeAuthAudit(c, {
    action: 'auth.login', status: 200,
    userId, orgId, actorRole: userRole, entityId: userId,
    entityLabel: email,
    detail: { method: 'sso_microsoft' },
  });

  return c.json({
    token,
    refreshToken,
    user: {
      id: userId, email, firstName: userFirstName,
      lastName: userLastName, role: userRole, isVerified: true,
      isPlatformAdmin, isPermitAuthority,
    },
    organisation: {
      id: orgId, name: orgName, type: orgType,
      slug: orgSlug, regionCode
    }
  });
});

// ── SSO: Cloudflare Access — Get Auth URL ───────────────────────────────────
authRoutes.get('/sso/cloudflare/url', async (c) => {
  const clientId = c.env.CF_ACCESS_CLIENT_ID;
  const issuer = c.env.CF_ACCESS_ISSUER;
  if (!clientId || !issuer) return c.json({ error: 'Cloudflare Access SSO is not configured' }, 501);

  const state = generateId();
  const isDev = c.env.ENVIRONMENT === 'development';
  const url = buildCfAccessAuthUrl(issuer, clientId, state, isDev);

  return c.json({ url, state });
});

// ── SSO: Cloudflare Access — Exchange Code ──────────────────────────────────
authRoutes.post('/sso/cloudflare/callback', async (c) => {
  const { code } = await c.req.json();
  if (!code) return c.json({ error: 'Authorization code is required' }, 400);

  const clientId = c.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = c.env.CF_ACCESS_CLIENT_SECRET;
  const issuer = c.env.CF_ACCESS_ISSUER;
  if (!clientId || !clientSecret || !issuer) return c.json({ error: 'Cloudflare Access SSO is not configured' }, 501);

  const db = c.env.DB;
  const isDev = c.env.ENVIRONMENT === 'development';

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCfAccessCode(issuer, clientId, clientSecret, code, isDev);
  } catch (err) {
    console.error('[sso:cf] Token exchange error:', err);
    return c.json({ error: 'Failed to authenticate with Cloudflare Access. Please try again.' }, 400);
  }

  // Fetch user info
  let userInfo;
  try {
    userInfo = await fetchCfAccessUserInfo(issuer, tokens.access_token);
  } catch (err) {
    console.error('[sso:cf] Userinfo error:', err);
    return c.json({ error: 'Failed to fetch user profile from Cloudflare Access.' }, 400);
  }

  const email = (userInfo.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return c.json({ error: 'Could not determine email from Cloudflare Access.' }, 400);
  }

  const firstName = userInfo.given_name || userInfo.name?.split(' ')[0] || 'User';
  const surname = userInfo.family_name || userInfo.name?.split(' ').slice(1).join(' ') || '';

  // Check if user already exists
  const existingUser = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.is_permit_authority, u.org_id, u.status,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(email).first();

  // SSO must not resurrect a deactivated account.
  if (existingUser && (existingUser.status as string) !== 'active') {
    await writeAuthAudit(c, {
      action: 'auth.login.deactivated', status: 403,
      userId: existingUser.id as string, orgId: existingUser.org_id as string,
      actorRole: existingUser.role as string, entityId: existingUser.id as string,
      entityLabel: email,
      detail: { status: existingUser.status, method: 'sso_cloudflare' },
    });
    return c.json({
      error: 'This account has been deactivated. Contact your organisation admin.',
      deactivated: true,
    }, 403);
  }

  let userId: string;
  let orgId: string;
  let userRole: string;
  let userFirstName: string;
  let userLastName: string;
  let orgName: string;
  let orgType: string;
  let orgSlug: string;
  let regionCode: string;
  let isPlatformAdmin = false;
  let isPermitAuthority = false;

  if (existingUser) {
    userId = existingUser.id as string;
    orgId = existingUser.org_id as string;
    userRole = existingUser.role as string;
    userFirstName = existingUser.first_name as string;
    userLastName = existingUser.last_name as string;
    orgName = existingUser.org_name as string;
    orgType = existingUser.org_type as string;
    orgSlug = existingUser.slug as string;
    regionCode = existingUser.region_code as string;
    isPlatformAdmin = Number(existingUser.is_platform_admin ?? 0) === 1;
    isPermitAuthority = Number(existingUser.is_permit_authority ?? 0) === 1;

    if (!existingUser.is_verified) {
      await db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').bind(userId).run();
    }
  } else {
    orgId = generateId();
    userId = generateId();
    const slug = await uniqueOrgSlug(db, `${firstName}-${surname}`);

    await db.batch([
      db.prepare(
        `INSERT INTO organisations (id, slug, name, org_type, region_code)
         VALUES (?, ?, ?, 'individual', 'NA_ASHRAE')`
      ).bind(orgId, slug, `${firstName}'s Workspace`),

      db.prepare(
        `INSERT INTO users (id, org_id, email, role, first_name, last_name, is_verified)
         VALUES (?, ?, ?, 'admin', ?, ?, 1)`
      ).bind(userId, orgId, email, firstName, surname),
    ]);

    userRole = 'admin';
    userFirstName = firstName;
    userLastName = surname;
    orgName = `${firstName}'s Workspace`;
    orgType = 'individual';
    orgSlug = slug;
    regionCode = 'NA_ASHRAE';

    const welcomeEmail = buildWelcomeEmail(firstName);
    welcomeEmail.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, welcomeEmail));
  }

  // ── MFA second-factor gate (returning SSO user) — see Microsoft callback. ─
  {
    const enrolled = await isMfaEnrolled(db, userId);
    const required = mfaRequiredFor(userRole, isPlatformAdmin);
    if (enrolled) {
      const raw = await createMfaChallenge(db, userId, orgId, 'login');
      await writeAuthAudit(c, {
        action: 'auth.mfa.challenge_started', status: 202,
        userId, orgId, actorRole: userRole, entityId: userId,
        entityLabel: email, detail: { method: 'sso_cloudflare' },
      });
      return c.json({ mfaRequired: true, mfaChallengeToken: raw, methods: ['totp', 'email', 'backup'], email }, 202);
    }
    if (required) {
      const raw = await createMfaChallenge(db, userId, orgId, 'enroll');
      await writeAuthAudit(c, {
        action: 'auth.mfa.enrollment_required', status: 403,
        userId, orgId, actorRole: userRole, entityId: userId,
        entityLabel: email, detail: { method: 'sso_cloudflare' },
      });
      return c.json({
        enrollmentRequired: true, mfaEnrollToken: raw, email,
        message: 'Your role requires multi-factor authentication. Set it up to continue.',
      }, 403);
    }
  }

  // Create session
  const { accessToken: token, refreshToken } = await mintTokenPair(db, userId, orgId);

  await writeAuthAudit(c, {
    action: 'auth.login', status: 200,
    userId, orgId, actorRole: userRole, entityId: userId,
    entityLabel: email,
    detail: { method: 'sso_cloudflare' },
  });

  return c.json({
    token,
    refreshToken,
    user: {
      id: userId, email, firstName: userFirstName,
      lastName: userLastName, role: userRole, isVerified: true,
      isPlatformAdmin, isPermitAuthority,
    },
    organisation: {
      id: orgId, name: orgName, type: orgType,
      slug: orgSlug, regionCode
    }
  });
});

// ── Invite preview ──────────────────────────────────────────────────────────
//
// GET /api/auth/invite/:token — return the invite details so the
// OnboardingPage can show "You're invited to join {Org} as a {role}" before
// the recipient sets a password. No auth required (the token IS the auth).
//
// Returns 404 for: unknown token, revoked invite, expired invite, OR if the
// invited email already belongs to a registered user (cannot redeem twice).
authRoutes.get('/invite/:token', async (c) => {
  const token = c.req.param('token');
  const db = c.env.DB;

  const invite = await db.prepare(
    `SELECT i.id, i.invited_email, i.invited_role, i.status, i.expires_at, i.kind,
            o.name AS org_name, o.org_type, o.slug,
            u.first_name AS inviter_first_name, u.last_name AS inviter_last_name,
            u.email AS inviter_email
     FROM org_invites i
     LEFT JOIN organisations o ON o.id = i.org_id
     LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token = ?`
  ).bind(token).first();

  if (!invite) return c.json({ error: 'Invitation not found' }, 404);
  // Reparent requests are consented to IN-APP by the existing account owner
  // (GET /api/auth/transfers) — the token is never a signup credential.
  if (invite.kind === 'reparent') {
    return c.json({
      error: 'This is an account-transfer request. Sign in to your existing account to review it.',
      alreadyRegistered: true,
    }, 409);
  }
  if (invite.status !== 'pending') {
    return c.json({ error: `This invitation has already been ${invite.status}.` }, 410);
  }
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    return c.json({ error: 'This invitation has expired. Ask the inviter to send a new one.' }, 410);
  }
  // Block re-redemption: if the email is already registered, kick them to
  // sign-in instead of creating a duplicate account.
  const existing = await db.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(invite.invited_email).first();
  if (existing) {
    return c.json({
      error: 'This email is already registered. Please sign in instead.',
      alreadyRegistered: true,
    }, 409);
  }

  return c.json({
    invitedEmail: invite.invited_email,
    invitedRole: invite.invited_role,
    expiresAt: invite.expires_at,
    organisation: {
      name: invite.org_name,
      type: invite.org_type,
      slug: invite.slug,
    },
    inviter: {
      firstName: invite.inviter_first_name,
      lastName: invite.inviter_last_name,
      email: invite.inviter_email,
    },
  });
});

// ── Invite redeem ───────────────────────────────────────────────────────────
//
// POST /api/auth/invite/:token/redeem
// Body: { firstName, lastName, password }
//
// The token-bearing recipient creates their account inside the inviter's
// org with the role set on the invite row. They are MARKED VERIFIED on
// creation — the email link itself proves they own the address, so we
// don't need a second OTP loop for invited members. A session is returned
// immediately; the OnboardingPage saves it and lands them in the dashboard.
//
// Concurrency safety: invites are atomically marked 'accepted' by binding
// the UPDATE to status='pending', which fails the second of two parallel
// redemptions with rows-affected=0.
authRoutes.post('/invite/:token/redeem', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json();
  const firstName = (body.firstName ?? '').toString().trim();
  const lastName = (body.lastName ?? '').toString().trim();
  const password = (body.password ?? '').toString();

  if (!firstName || !lastName) {
    return c.json({ error: 'First and last name are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const db = c.env.DB;
  const invite = await db.prepare(
    `SELECT id, org_id, invited_email, invited_role, status, expires_at, kind
     FROM org_invites WHERE token = ?`
  ).bind(token).first();

  if (!invite) return c.json({ error: 'Invitation not found' }, 404);
  // Reparent requests never create accounts — in-app consent only.
  if (invite.kind === 'reparent') {
    return c.json({
      error: 'This is an account-transfer request. Sign in to your existing account to review it.',
      alreadyRegistered: true,
    }, 409);
  }
  if (invite.status !== 'pending') {
    return c.json({ error: `This invitation has already been ${invite.status}.` }, 410);
  }
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    return c.json({ error: 'This invitation has expired.' }, 410);
  }

  const email = invite.invited_email as string;

  // Double-check the email isn't already taken (between preview and redeem
  // someone could have registered separately).
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return c.json({
      error: 'This email is already registered. Please sign in instead.',
      alreadyRegistered: true,
    }, 409);
  }

  const userId = generateId();
  const passwordHash = await hashPassword(password);

  // Create the user FIRST so we have a valid user id to point accepted_by
  // at — the org_invites foreign key requires accepted_by to reference an
  // existing user. The atomic claim below uses status='pending' as the
  // race-protection flag, so a duplicate redemption still fails cleanly.
  await db.prepare(
    `INSERT INTO users
       (id, org_id, email, password_hash, role, first_name, last_name, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(userId, invite.org_id, email, passwordHash,
         invite.invited_role, firstName, lastName).run();

  // Atomic redemption: only marks the invite accepted if it's still pending.
  const claim = await db.prepare(
    `UPDATE org_invites
       SET status = 'accepted',
           accepted_by = ?,
           accepted_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).bind(userId, invite.id).run();
  if (!claim.meta.changes) {
    // Rollback the user we just created — the invite was claimed by another
    // request between our SELECT and UPDATE.
    await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    return c.json({ error: 'Invitation was redeemed by someone else.' }, 409);
  }

  // Mint a session.
  const { accessToken: sessionToken, refreshToken } = await mintTokenPair(db, userId, invite.org_id as string);

  // Pull org/user shape for the response.
  const userData = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_platform_admin, u.is_permit_authority, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ?`
  ).bind(userId).first();

  await writeAuthAudit(c, {
    action: 'auth.invite_redeemed', status: 200,
    userId, orgId: invite.org_id as string,
    actorRole: invite.invited_role as string, entityId: userId,
    entityLabel: userData!.email as string,
    detail: { invitedRole: invite.invited_role, joinedOrg: userData!.org_name },
  });

  return c.json({
    token: sessionToken,
    refreshToken,
    user: {
      id: userData!.id, email: userData!.email, firstName: userData!.first_name,
      lastName: userData!.last_name, role: userData!.role, isVerified: true,
      isPlatformAdmin: Number(userData!.is_platform_admin ?? 0) === 1,
      isPermitAuthority: Number(userData!.is_permit_authority ?? 0) === 1,
    },
    organisation: {
      id: userData!.org_id, name: userData!.org_name, type: userData!.org_type,
      slug: userData!.slug, regionCode: userData!.region_code,
    },
  });
});

// ── Account transfers (reparent consent) ────────────────────────────────────
//
// The receiving side of POST /api/org/reparent. A tenant admin creates a
// kind='reparent' org_invites row; the TARGET user reviews it here, behind
// their own login. Per-route authMiddleware (same pattern as /mfa/*) —
// these live under the public /api/auth mount, so the global middleware
// chain doesn't cover them.
//
// Identity binding: rows are matched on invited_email = the SESSION user's
// email. The invite id alone grants nothing to anyone else.
authRoutes.use('/transfers', authMiddleware);
authRoutes.use('/transfers/*', authMiddleware);

// GET /api/auth/transfers — pending transfer requests addressed to me.
authRoutes.get('/transfers', async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  const { results } = await db.prepare(
    `SELECT i.id, i.invited_role, i.expires_at, i.created_at,
            o.name AS org_name, o.org_type,
            u.first_name AS inviter_first_name, u.last_name AS inviter_last_name,
            u.email AS inviter_email
     FROM org_invites i
     LEFT JOIN organisations o ON o.id = i.org_id
     LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.invited_email = ? AND i.kind = 'reparent'
       AND i.status = 'pending' AND i.expires_at > ?
     ORDER BY i.created_at DESC`
  ).bind(user.email.toLowerCase(), nowIso()).all();

  return c.json({ transfers: results });
});

/** Load + validate a pending reparent invite addressed to the session user. */
async function loadMyTransfer(
  db: D1Database, inviteId: string, userEmail: string,
): Promise<{ ok: true; invite: Record<string, unknown> } | { ok: false; error: string; code: 404 | 410 }> {
  const invite = await db.prepare(
    `SELECT id, org_id, invited_email, invited_role, status, expires_at
     FROM org_invites WHERE id = ? AND kind = 'reparent'`
  ).bind(inviteId).first();
  // Same 404 for "not found" and "not addressed to you" — don't leak the
  // existence of other users' transfer requests.
  if (!invite || (invite.invited_email as string) !== userEmail.toLowerCase()) {
    return { ok: false, error: 'Transfer request not found', code: 404 };
  }
  if (invite.status !== 'pending') {
    return { ok: false, error: `This transfer request has already been ${invite.status}.`, code: 410 };
  }
  if (new Date(invite.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: 'This transfer request has expired.', code: 410 };
  }
  return { ok: true, invite: invite as Record<string, unknown> };
}

// POST /api/auth/transfers/:id/accept — move my account into the requesting
// org. Moves the PERSON, not their data: projects/calcs stay in the old org.
// All old sessions + refresh tokens die (org context changed everywhere);
// a fresh pair for the new org is returned so this client stays signed in.
authRoutes.post('/transfers/:id/accept', async (c) => {
  const user = c.get('user') as AuthUser;
  if (user.isImpersonating) {
    return c.json({ error: 'Not available during impersonation' }, 403);
  }
  const db = c.env.DB;

  const loaded = await loadMyTransfer(db, c.req.param('id'), user.email);
  if (!loaded.ok) return c.json({ error: loaded.error }, loaded.code);
  const invite = loaded.invite;

  const fromOrgId = user.orgId;

  // Continuity guards on the org being left behind:
  //  • configured permit authority → moving its only member strands live
  //    submissions pointed at it; needs platform support instead.
  //  • grew past solo since the request → no longer a fragmented user;
  //    the multi-member rule from the request side applies here too.
  const oldOrg = await db.prepare(
    `SELECT authority_type FROM organisations WHERE id = ?`
  ).bind(fromOrgId).first();
  if (oldOrg?.authority_type) {
    return c.json({
      error: 'Your organisation is a configured permit authority. Contact platform support to transfer this account.',
    }, 409);
  }
  const peers = await db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND status = 'active'`
  ).bind(fromOrgId).first();
  if (Number(peers?.n ?? 0) > 1) {
    return c.json({
      error: 'Your organisation has other active members. Contact platform support to transfer this account.',
    }, 409);
  }

  // Atomic claim — rows-affected guard kills double-accept races.
  const claim = await db.prepare(
    `UPDATE org_invites
       SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).bind(user.id, invite.id).run();
  if (!claim.meta.changes) {
    return c.json({ error: 'This transfer request is no longer pending.' }, 409);
  }

  await db.prepare(
    `UPDATE users SET org_id = ?, role = ? WHERE id = ?`
  ).bind(invite.org_id, invite.invited_role, user.id).run();

  // Old org context is dead everywhere: purge sessions, revoke refresh chain.
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(user.id).run();
  await db.prepare(
    `UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`
  ).bind(user.id).run();

  // Fresh pair + login-shaped body for the NEW org.
  const session = await buildSessionResponse(db, user.id);
  if (!session) return c.json({ error: 'Account is not active' }, 401);

  await writeAuthAudit(c, {
    action: 'auth.reparent_accepted', status: 200,
    userId: user.id, orgId: invite.org_id as string,
    actorRole: invite.invited_role as string, entityId: user.id,
    entityLabel: user.email,
    detail: {
      fromOrgId,
      toOrgId: invite.org_id,
      invitedRole: invite.invited_role,
      orphanedOrgId: fromOrgId,
    },
  });

  return c.json({ token: session.token, refreshToken: session.refreshToken, ...session.body });
});

// POST /api/auth/transfers/:id/decline — refuse the request. Reuses the
// 'revoked' status (the CHECK constraint predates 'declined'); the audit
// row records who said no.
authRoutes.post('/transfers/:id/decline', async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.env.DB;

  const loaded = await loadMyTransfer(db, c.req.param('id'), user.email);
  if (!loaded.ok) return c.json({ error: loaded.error }, loaded.code);
  const invite = loaded.invite;

  const r = await db.prepare(
    `UPDATE org_invites SET status = 'revoked' WHERE id = ? AND status = 'pending'`
  ).bind(invite.id).run();
  if (!r.meta.changes) {
    return c.json({ error: 'This transfer request is no longer pending.' }, 409);
  }

  await writeAuthAudit(c, {
    action: 'auth.reparent_declined', status: 200,
    userId: user.id, orgId: user.orgId,
    actorRole: user.role, entityId: invite.id as string,
    entityLabel: user.email,
    detail: { requestingOrgId: invite.org_id, declinedByUser: true },
  });

  return c.json({ ok: true });
});

// ── Logout ───────────────────────────────────────────────────────────────────
authRoutes.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenHash = await hashToken(token);
    // Resolve the session owner BEFORE deleting so the audit row has
    // identity. Best-effort — a stale/invalid token just logs an
    // anonymous logout.
    const sess = await c.env.DB.prepare(
      `SELECT s.user_id, s.org_id, u.email, u.role
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    ).bind(tokenHash).first();
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(tokenHash).run();
    // End the session fully, not just the current access token: revoke the
    // user's refresh tokens too. Best-effort — needs a resolvable owner.
    if (sess?.user_id) {
      await c.env.DB.prepare(
        `UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`
      ).bind(sess.user_id).run();
    }
    await writeAuthAudit(c, {
      action: 'auth.logout', status: 200,
      userId: (sess?.user_id as string) ?? null,
      orgId: (sess?.org_id as string) ?? null,
      actorRole: (sess?.role as string) ?? null,
      entityId: (sess?.user_id as string) ?? null,
      entityLabel: (sess?.email as string) ?? null,
    });
  }
  return c.json({ ok: true });
});

// ── Refresh ───────────────────────────────────────────────────────────────────
// Exchange a valid refresh token for a fresh access + refresh pair (rotation).
// The refresh token is the long-lived credential and is presented ONLY here,
// never on ordinary requests. Rotation is single-use: each refresh consumes
// the presented token and issues a new one.
//
// Reuse detection: presenting an already-consumed (revoked) refresh token
// signals theft — a stolen copy replayed after the legitimate client rotated.
// The response revokes EVERY active refresh token for the user, killing both
// chains and forcing a clean re-login. Deactivated users are stopped by the
// status gate below — the same authoritative backstop the access path uses,
// so deactivation paths don't separately purge refresh tokens.
authRoutes.post('/refresh', async (c) => {
  const db = c.env.DB;

  let presented: string | undefined;
  try {
    const body = (await c.req.json()) as { refreshToken?: string };
    presented = body.refreshToken;
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }
  if (!presented || typeof presented !== 'string') {
    return c.json({ error: 'refreshToken is required' }, 400);
  }

  const presentedHash = await hashToken(presented);
  const row = await db.prepare(
    `SELECT r.id, r.user_id, r.org_id, r.expires_at, r.revoked_at, u.status
     FROM refresh_tokens r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ?`
  ).bind(presentedHash).first();

  if (!row) return c.json({ error: 'Invalid refresh token' }, 401);

  // Reuse of a consumed token. Two very different causes share this shape:
  //  • THEFT — a stolen copy replayed long after the legitimate rotation.
  //  • RACE — two tabs/windows sharing localStorage both hit the 30-min
  //    access expiry and rotated simultaneously; the loser replays a token
  //    consumed milliseconds ago. The client serializes rotation with a Web
  //    Lock, but older sessions and edge cases (frozen tabs) still race.
  // A token revoked within the last 60s is treated as the benign race: the
  // loser gets a plain 401 and adopts the winner's pair from localStorage —
  // WITHOUT nuking every session the user has. Outside the grace window the
  // full theft response stands.
  if (row.revoked_at) {
    const revokedAtMs = new Date(String(row.revoked_at).replace(' ', 'T') + 'Z').getTime();
    const withinGrace = Number.isFinite(revokedAtMs) && Date.now() - revokedAtMs < 60_000;
    if (withinGrace) {
      await writeAuthAudit(c, {
        action: 'auth.refresh_reuse', status: 401,
        userId: row.user_id as string, orgId: row.org_id as string,
        actorRole: null, entityId: row.user_id as string, entityLabel: null,
        detail: { revokedAllRefreshTokens: false, graceWindowRace: true },
      });
      return c.json({ error: 'Refresh token already rotated' }, 401);
    }
    await db.prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`
    ).bind(row.user_id).run();
    await writeAuthAudit(c, {
      action: 'auth.refresh_reuse', status: 401,
      userId: row.user_id as string, orgId: row.org_id as string,
      actorRole: null, entityId: row.user_id as string, entityLabel: null,
      detail: { revokedAllRefreshTokens: true },
    });
    return c.json({ error: 'Session security check failed. Please sign in again.' }, 401);
  }

  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return c.json({ error: 'Refresh token expired' }, 401);
  }
  if (row.status !== 'active') {
    return c.json({ error: 'Account is not active' }, 401);
  }

  const userId = row.user_id as string;
  const orgId = row.org_id as string;

  // Mint the new pair FIRST, then consume the presented token. Order matters:
  // if minting fails, the presented token stays valid (fail-safe — the client
  // can retry) rather than leaving the user with no working credential.
  const { accessToken, refreshToken } = await mintTokenPair(db, userId, orgId);
  await db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`)
    .bind(row.id).run();

  return c.json({ token: accessToken, refreshToken });
});

// ── Get current session user ─────────────────────────────────────────────────
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

  const token = authHeader.slice(7);
  const db = c.env.DB;

  // Bound ISO now, not datetime('now') — see utils/time.ts for why.
  const result = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.is_permit_authority,
            s.org_id, s.is_impersonation,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organisations o ON o.id = s.org_id
     WHERE s.token = ? AND s.expires_at > ?
       AND u.status = 'active'`
  ).bind(await hashToken(token), nowIso()).first();

  if (!result) return c.json({ error: 'Session expired' }, 401);

  return c.json({
    user: {
      id: result.id, email: result.email, firstName: result.first_name,
      lastName: result.last_name, role: result.role, isVerified: !!result.is_verified,
      isPlatformAdmin: Number(result.is_platform_admin ?? 0) === 1,
      isPermitAuthority: Number(result.is_permit_authority ?? 0) === 1,
    },
    organisation: {
      // Session-scoped org: during impersonation this is the TARGET tenant.
      id: result.org_id, name: result.org_name, type: result.org_type,
      slug: result.slug, regionCode: result.region_code
    },
    impersonating: Number(result.is_impersonation ?? 0) === 1,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MFA (TOTP) — second-factor enrollment, management, and login completion
// ═════════════════════════════════════════════════════════════════════════════
//
// SECURITY MODEL (see C:/Users/ngriffith/.claude/plans/mfa-design.md):
//  - The AUTHED management endpoints (status/enroll/confirm/disable) manage the
//    SESSION user's OWN factor. They run behind authMiddleware (registered just
//    below) and ALWAYS bind c.get('user').id — never a client-supplied id.
//  - The PUBLIC endpoints (challenge/email-code/enroll-grace/confirm-grace) are
//    pre-session: the user has no bearer yet. They resolve the user ONLY via the
//    opaque, single-use, hashed challenge token (loadMfaChallenge) — never from
//    request-supplied identity. mintTokenPair runs ONLY inside /challenge and
//    /confirm-grace, AFTER server-side factor verification AND atomic single-use
//    challenge consumption (UPDATE ... consumed_at WHERE id=? AND consumed_at IS
//    NULL, then meta.changes===1 BEFORE the mint). No bypass, no admin lockout.
//  - MFA_ENC_KEY unset → enroll refuses (503), never stores a plaintext secret.
//  - Rate-limiting reuses rate_limit_events keyed mfa:<userId>, recorded only on
//    a FAILED attempt.
//  - Backup codes are PBKDF2-hashed and one-time (used_at marked with a
//    rows-affected guard).

// Per-route auth: the four management endpoints require a live session. The
// public challenge/grace/email endpoints are deliberately NOT listed here.
authRoutes.use('/mfa/status', authMiddleware);
authRoutes.use('/mfa/enroll', authMiddleware);
authRoutes.use('/mfa/confirm', authMiddleware);
authRoutes.use('/mfa/disable', authMiddleware);

const MFA_RL_WINDOW_MIN = 15;
const MFA_RL_MAX_VERIFY = 5; // challenge / confirm / disable
const MFA_RL_MAX_EMAIL = 3;  // email-code dispatch

/** Count how many UNUSED backup codes a user has left. */
async function backupCodesRemaining(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM mfa_backup_codes WHERE user_id = ? AND used_at IS NULL`,
  ).bind(userId).first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Verify a backup code for a user and atomically mark it used. Returns true on
 * a first-time match, false otherwise. The used_at flip carries a rows-affected
 * guard (WHERE id=? AND used_at IS NULL) so a code can NEVER be redeemed twice,
 * even under concurrent submission.
 */
async function consumeBackupCode(db: D1Database, userId: string, code: string): Promise<boolean> {
  const candidate = code.trim().toUpperCase();
  if (!candidate) return false;
  const { results } = await db.prepare(
    `SELECT id, code_hash FROM mfa_backup_codes WHERE user_id = ? AND used_at IS NULL`,
  ).bind(userId).all<{ id: string; code_hash: string }>();
  for (const row of results ?? []) {
    if (await verifyPassword(candidate, row.code_hash)) {
      const upd = await db.prepare(
        `UPDATE mfa_backup_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`,
      ).bind(row.id).run();
      // Rows-affected guard: only a winning, first-time consumption returns true.
      return upd.meta.changes === 1;
    }
  }
  return false;
}

/**
 * Atomically consume a challenge row (single-use). Returns true iff THIS call
 * was the one that flipped consumed_at from NULL — the gate that must pass
 * BEFORE mintTokenPair. A replayed/already-consumed token returns false.
 */
async function consumeChallenge(db: D1Database, challengeId: string): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE mfa_challenges SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`,
  ).bind(challengeId).run();
  return res.meta.changes === 1;
}

// ── GET /api/auth/mfa/status (authed) ────────────────────────────────────────
authRoutes.get('/mfa/status', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const cred = await db.prepare(
    `SELECT type, confirmed_at FROM mfa_credentials
     WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NOT NULL`,
  ).bind(user.id).first<{ type: string }>();
  const enabled = !!cred;
  return c.json({
    enabled,
    method: enabled ? 'totp' : null,
    required: mfaRequiredFor(user.role, user.isPlatformAdmin),
    backupCodesRemaining: enabled ? await backupCodesRemaining(db, user.id) : 0,
  });
});

// ── POST /api/auth/mfa/enroll (authed) — begin enrollment ────────────────────
authRoutes.post('/mfa/enroll', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // REFUSE if the encryption key is unset — never store a plaintext secret.
  if (!isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
    return c.json({ error: 'MFA is not configured on this server. Contact your administrator.' }, 503);
  }

  // A confirmed credential blocks re-enroll (must disable first).
  const existing = await db.prepare(
    `SELECT confirmed_at FROM mfa_credentials WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NOT NULL`,
  ).bind(user.id).first();
  if (existing) {
    return c.json({ error: 'MFA is already enabled. Disable it first to re-enroll.' }, 409);
  }

  const secret = randomBase32Secret();
  const enc = await encryptSecret(secret, c.env.MFA_ENC_KEY);
  // Replace any prior UNCONFIRMED row (single pending enrollment per type).
  await db.prepare(
    `INSERT OR REPLACE INTO mfa_credentials (id, user_id, type, secret_encrypted, confirmed_at)
     VALUES (?, ?, 'totp', ?, NULL)`,
  ).bind(generateId(), user.id, enc).run();

  await writeAuthAudit(c, {
    action: 'auth.mfa.enroll_started', status: 200,
    userId: user.id, orgId: user.orgId, actorRole: user.role,
    entityId: user.id, entityLabel: user.email, detail: { method: 'totp' },
  });

  return c.json({ secret, otpauthUri: buildOtpauthUri(secret, user.email) });
});

// ── POST /api/auth/mfa/confirm (authed) — activate + issue backup codes ──────
authRoutes.post('/mfa/confirm', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const code = (body.code ?? '').toString().trim();

  const limit = await checkRateLimit(db, `mfa:${user.id}`, 'mfa_confirm', MFA_RL_MAX_VERIFY, MFA_RL_WINDOW_MIN);
  if (!limit.allowed) {
    return c.json({ error: 'Too many attempts. Try again shortly.', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  if (!isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
    return c.json({ error: 'MFA is not configured on this server. Contact your administrator.' }, 503);
  }

  const pending = await db.prepare(
    `SELECT id, secret_encrypted FROM mfa_credentials
     WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NULL`,
  ).bind(user.id).first<{ id: string; secret_encrypted: string }>();
  if (!pending) {
    return c.json({ error: 'No pending enrollment. Start enrollment first.' }, 400);
  }

  const secret = await decryptSecret(pending.secret_encrypted, c.env.MFA_ENC_KEY);
  if (!(await verifyTotp(secret, code))) {
    await recordRateLimitEvent(db, `mfa:${user.id}`, 'mfa_confirm');
    await writeAuthAudit(c, {
      action: 'auth.mfa.confirm_failed', status: 401,
      userId: user.id, orgId: user.orgId, actorRole: user.role,
      entityId: user.id, entityLabel: user.email, detail: { method: 'totp' },
    });
    return c.json({ error: 'Invalid code. Check your authenticator app and try again.' }, 401);
  }

  // Activate + (re)issue backup codes atomically.
  const backupCodes = generateBackupCodes();
  const hashed = await Promise.all(backupCodes.map((bc) => hashPassword(bc)));
  const batch: D1PreparedStatement[] = [
    db.prepare(`UPDATE mfa_credentials SET confirmed_at = datetime('now'), last_used_at = datetime('now') WHERE id = ?`).bind(pending.id),
    db.prepare(`DELETE FROM mfa_backup_codes WHERE user_id = ?`).bind(user.id),
    db.prepare(`UPDATE users SET mfa_enforced_at = COALESCE(mfa_enforced_at, datetime('now')) WHERE id = ?`).bind(user.id),
  ];
  for (const h of hashed) {
    batch.push(db.prepare(`INSERT INTO mfa_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`).bind(generateId(), user.id, h));
  }
  await db.batch(batch);

  await writeAuthAudit(c, {
    action: 'auth.mfa.enrolled', status: 200,
    userId: user.id, orgId: user.orgId, actorRole: user.role,
    entityId: user.id, entityLabel: user.email, detail: { method: 'totp' },
  });

  return c.json({ enabled: true, backupCodes });
});

// ── POST /api/auth/mfa/disable (authed) — re-verify, then remove ─────────────
authRoutes.post('/mfa/disable', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const code = (body.code ?? '').toString().trim();

  const limit = await checkRateLimit(db, `mfa:${user.id}`, 'mfa_confirm', MFA_RL_MAX_VERIFY, MFA_RL_WINDOW_MIN);
  if (!limit.allowed) {
    return c.json({ error: 'Too many attempts. Try again shortly.', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  const cred = await db.prepare(
    `SELECT secret_encrypted FROM mfa_credentials
     WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NOT NULL`,
  ).bind(user.id).first<{ secret_encrypted: string }>();
  if (!cred) {
    return c.json({ error: 'MFA is not enabled.' }, 400);
  }

  // Re-verify: a hijacked live session must not silently strip MFA. Accept a
  // TOTP code OR a one-time backup code.
  let ok = false;
  if (/^\d{6}$/.test(code) && isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
    const secret = await decryptSecret(cred.secret_encrypted, c.env.MFA_ENC_KEY);
    ok = await verifyTotp(secret, code);
  }
  if (!ok) {
    ok = await consumeBackupCode(db, user.id, code);
  }
  if (!ok) {
    await recordRateLimitEvent(db, `mfa:${user.id}`, 'mfa_confirm');
    await writeAuthAudit(c, {
      action: 'auth.mfa.disable_failed', status: 401,
      userId: user.id, orgId: user.orgId, actorRole: user.role,
      entityId: user.id, entityLabel: user.email,
    });
    return c.json({ error: 'Invalid code.' }, 401);
  }

  await db.batch([
    db.prepare(`DELETE FROM mfa_credentials WHERE user_id = ?`).bind(user.id),
    db.prepare(`DELETE FROM mfa_backup_codes WHERE user_id = ?`).bind(user.id),
  ]);

  await writeAuthAudit(c, {
    action: 'auth.mfa.disabled', status: 200,
    userId: user.id, orgId: user.orgId, actorRole: user.role,
    entityId: user.id, entityLabel: user.email,
  });

  return c.json({ enabled: false });
});

// ── POST /api/auth/mfa/challenge (PUBLIC) — completes a 'login' challenge ────
//
// The ONLY path that converts a 'login' challenge into a real session. Verifies
// the second factor server-side, atomically consumes the single-use challenge,
// and only THEN mints the token pair.
authRoutes.post('/mfa/challenge', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const challengeToken = (body.challengeToken ?? '').toString();
  const code = (body.code ?? '').toString().trim();
  const method = (body.method ?? 'totp').toString();

  if (!challengeToken) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);

  const challenge = await loadMfaChallenge(db, challengeToken, 'login');
  if (!challenge) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);

  // Per-attempt rate limit keyed to the challenge's user (resolved from the
  // token, never the client). A locked-out user can't keep guessing even with a
  // still-valid challenge.
  const limit = await checkRateLimit(db, `mfa:${challenge.user_id}`, 'mfa_challenge', MFA_RL_MAX_VERIFY, MFA_RL_WINDOW_MIN);
  if (!limit.allowed) {
    return c.json({ error: 'Too many attempts. Try again shortly.', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  const cred = await db.prepare(
    `SELECT id, secret_encrypted FROM mfa_credentials
     WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NOT NULL`,
  ).bind(challenge.user_id).first<{ id: string; secret_encrypted: string }>();
  if (!cred) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);

  // Resolve the user's email for the email-OTP path / failure audit.
  const userRow = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(challenge.user_id).first<{ email: string }>();

  let verified = false;
  if (method === 'totp') {
    if (isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
      const secret = await decryptSecret(cred.secret_encrypted, c.env.MFA_ENC_KEY);
      verified = await verifyTotp(secret, code);
    }
  } else if (method === 'backup') {
    verified = await consumeBackupCode(db, challenge.user_id, code);
  } else if (method === 'email') {
    if (userRow?.email) {
      const r = await validateVerificationCode(db, userRow.email, code, 'mfa_verification');
      verified = r.valid && r.userId === challenge.user_id;
    }
  }

  if (!verified) {
    await recordRateLimitEvent(db, `mfa:${challenge.user_id}`, 'mfa_challenge');
    await writeAuthAudit(c, {
      action: 'auth.mfa.challenge_failed', status: 401,
      userId: challenge.user_id, orgId: challenge.org_id,
      entityId: challenge.user_id, entityLabel: userRow?.email ?? null,
      detail: { method },
    });
    return c.json({ error: 'Invalid code.' }, 401);
  }

  // ATOMIC single-use consumption BEFORE minting. If another request already
  // consumed this challenge, bail without minting (no double-session).
  if (!(await consumeChallenge(db, challenge.id))) {
    return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);
  }

  await db.prepare(
    `UPDATE mfa_credentials SET last_used_at = datetime('now') WHERE id = ?`,
  ).bind(cred.id).run();

  const session = await buildSessionResponse(db, challenge.user_id);
  if (!session) return c.json({ error: 'Account is not active.' }, 401);

  await writeAuthAudit(c, {
    action: 'auth.mfa.challenge_verified', status: 200,
    userId: challenge.user_id, orgId: challenge.org_id,
    entityId: challenge.user_id, entityLabel: userRow?.email ?? null,
    detail: { method },
  });

  return c.json(session.body);
});

// ── POST /api/auth/mfa/email-code (PUBLIC) — dispatch the email-OTP fallback ─
authRoutes.post('/mfa/email-code', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const challengeToken = (body.challengeToken ?? '').toString();
  if (!challengeToken) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);

  const challenge = await loadMfaChallenge(db, challengeToken, 'login');
  if (!challenge) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401);

  // Cap email dispatch spam (per-user).
  const limit = await checkRateLimit(db, `mfa:${challenge.user_id}`, 'mfa_email_send', MFA_RL_MAX_EMAIL, MFA_RL_WINDOW_MIN);
  if (!limit.allowed) {
    return c.json({ error: 'Too many requests. Try again shortly.', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }
  await recordRateLimitEvent(db, `mfa:${challenge.user_id}`, 'mfa_email_send');

  const userRow = await db.prepare(
    `SELECT email, first_name FROM users WHERE id = ?`,
  ).bind(challenge.user_id).first<{ email: string; first_name: string }>();
  if (userRow?.email) {
    const code = await createVerificationCode(db, challenge.user_id, userRow.email, 'mfa_verification');
    const msg = buildMfaEmailCode(userRow.first_name ?? 'there', code);
    msg.to = userRow.email;
    c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, msg));
  }

  // Always return ok (don't leak whether the user exists / has email).
  return c.json({ sent: true });
});

// ── POST /api/auth/mfa/enroll-grace (PUBLIC) — forced-enrollment, step 1 ─────
//
// A 'required'-but-not-enrolled login returns an 'enroll'-purpose challenge
// (NOT a session). The user is unauthenticated, so they can't call the authed
// /mfa/enroll. This resolves the user from the enroll challenge and begins
// enrollment — same crypto, no session minted yet.
authRoutes.post('/mfa/enroll-grace', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const enrollToken = (body.mfaEnrollToken ?? '').toString();
  if (!enrollToken) return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);

  const challenge = await loadMfaChallenge(db, enrollToken, 'enroll');
  if (!challenge) return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);

  if (!isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
    return c.json({ error: 'MFA is not configured on this server. Contact your administrator.' }, 503);
  }

  const userRow = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(challenge.user_id).first<{ email: string }>();
  if (!userRow?.email) return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);

  const secret = randomBase32Secret();
  const enc = await encryptSecret(secret, c.env.MFA_ENC_KEY);
  await db.prepare(
    `INSERT OR REPLACE INTO mfa_credentials (id, user_id, type, secret_encrypted, confirmed_at)
     VALUES (?, ?, 'totp', ?, NULL)`,
  ).bind(generateId(), challenge.user_id, enc).run();

  await writeAuthAudit(c, {
    action: 'auth.mfa.enroll_started', status: 200,
    userId: challenge.user_id, orgId: challenge.org_id,
    entityId: challenge.user_id, entityLabel: userRow.email, detail: { method: 'totp', grace: true },
  });

  return c.json({ secret, otpauthUri: buildOtpauthUri(secret, userRow.email) });
});

// ── POST /api/auth/mfa/confirm-grace (PUBLIC) — forced-enrollment, step 2 ────
//
// Confirms the pending credential AND mints the session in one flow — the admin
// enrolls and lands logged-in without ever having held a session without MFA.
// Atomically consumes the enroll challenge BEFORE minting.
authRoutes.post('/mfa/confirm-grace', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const enrollToken = (body.mfaEnrollToken ?? '').toString();
  const code = (body.code ?? '').toString().trim();
  if (!enrollToken) return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);

  const challenge = await loadMfaChallenge(db, enrollToken, 'enroll');
  if (!challenge) return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);

  const limit = await checkRateLimit(db, `mfa:${challenge.user_id}`, 'mfa_confirm', MFA_RL_MAX_VERIFY, MFA_RL_WINDOW_MIN);
  if (!limit.allowed) {
    return c.json({ error: 'Too many attempts. Try again shortly.', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  if (!isMfaKeyConfigured(c.env.MFA_ENC_KEY)) {
    return c.json({ error: 'MFA is not configured on this server. Contact your administrator.' }, 503);
  }

  const pending = await db.prepare(
    `SELECT id, secret_encrypted FROM mfa_credentials
     WHERE user_id = ? AND type = 'totp' AND confirmed_at IS NULL`,
  ).bind(challenge.user_id).first<{ id: string; secret_encrypted: string }>();
  if (!pending) {
    return c.json({ error: 'No pending enrollment. Start enrollment first.' }, 400);
  }

  const secret = await decryptSecret(pending.secret_encrypted, c.env.MFA_ENC_KEY);
  if (!(await verifyTotp(secret, code))) {
    await recordRateLimitEvent(db, `mfa:${challenge.user_id}`, 'mfa_confirm');
    await writeAuthAudit(c, {
      action: 'auth.mfa.confirm_failed', status: 401,
      userId: challenge.user_id, orgId: challenge.org_id,
      entityId: challenge.user_id, detail: { method: 'totp', grace: true },
    });
    return c.json({ error: 'Invalid code. Check your authenticator app and try again.' }, 401);
  }

  // ATOMIC single-use consumption of the enroll challenge BEFORE minting.
  if (!(await consumeChallenge(db, challenge.id))) {
    return c.json({ error: 'Enrollment session expired. Please sign in again.' }, 401);
  }

  // Activate the credential + issue backup codes atomically.
  const backupCodes = generateBackupCodes();
  const hashed = await Promise.all(backupCodes.map((bc) => hashPassword(bc)));
  const batch: D1PreparedStatement[] = [
    db.prepare(`UPDATE mfa_credentials SET confirmed_at = datetime('now'), last_used_at = datetime('now') WHERE id = ?`).bind(pending.id),
    db.prepare(`DELETE FROM mfa_backup_codes WHERE user_id = ?`).bind(challenge.user_id),
    db.prepare(`UPDATE users SET mfa_enforced_at = COALESCE(mfa_enforced_at, datetime('now')) WHERE id = ?`).bind(challenge.user_id),
  ];
  for (const h of hashed) {
    batch.push(db.prepare(`INSERT INTO mfa_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)`).bind(generateId(), challenge.user_id, h));
  }
  await db.batch(batch);

  const session = await buildSessionResponse(db, challenge.user_id);
  if (!session) return c.json({ error: 'Account is not active.' }, 401);

  await writeAuthAudit(c, {
    action: 'auth.mfa.enrolled', status: 200,
    userId: challenge.user_id, orgId: challenge.org_id,
    entityId: challenge.user_id, detail: { method: 'totp', grace: true },
  });

  return c.json({ ...session.body, backupCodes });
});
