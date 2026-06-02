import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { hashPassword, verifyPassword, isLegacyHash, hashToken } from '../utils/crypto';
import { mintTokenPair } from '../utils/session';
import { sendEmail, buildWelcomeEmail, buildVerificationEmail, buildPasswordResetEmail } from '../utils/email';
import { createVerificationCode, validateVerificationCode } from '../utils/verificationCodes';
import { checkRateLimit, recordRateLimitEvent, cleanupRateLimitEvents } from '../utils/rateLimit';
import { buildAuthUrl, exchangeCodeForTokens, fetchMicrosoftProfile, buildCfAccessAuthUrl, exchangeCfAccessCode, fetchCfAccessUserInfo } from '../utils/oauth';
import { writeAuthAudit } from '../middleware/audit';

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
}

export const authRoutes = new Hono<{ Bindings: Env }>();

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
  const slug = (orgName || `${firstName}-${lastName}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);

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
    const slug = `${firstName}-${surname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) || 'user';

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
    const slug = `${firstName}-${surname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) || 'user';

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
    `SELECT i.id, i.invited_email, i.invited_role, i.status, i.expires_at,
            o.name AS org_name, o.org_type, o.slug,
            u.first_name AS inviter_first_name, u.last_name AS inviter_last_name,
            u.email AS inviter_email
     FROM org_invites i
     LEFT JOIN organisations o ON o.id = i.org_id
     LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token = ?`
  ).bind(token).first();

  if (!invite) return c.json({ error: 'Invitation not found' }, 404);
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
    `SELECT id, org_id, invited_email, invited_role, status, expires_at
     FROM org_invites WHERE token = ?`
  ).bind(token).first();

  if (!invite) return c.json({ error: 'Invitation not found' }, 404);
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

  // Reuse of a consumed token → theft response: revoke the user's whole set.
  if (row.revoked_at) {
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

  const result = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.is_permit_authority, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organisations o ON o.id = s.org_id
     WHERE s.token = ? AND s.expires_at > datetime('now')
       AND u.status = 'active'`
  ).bind(await hashToken(token)).first();

  if (!result) return c.json({ error: 'Session expired' }, 401);

  return c.json({
    user: {
      id: result.id, email: result.email, firstName: result.first_name,
      lastName: result.last_name, role: result.role, isVerified: !!result.is_verified,
      isPlatformAdmin: Number(result.is_platform_admin ?? 0) === 1,
      isPermitAuthority: Number(result.is_permit_authority ?? 0) === 1,
    },
    organisation: {
      id: result.org_id, name: result.org_name, type: result.org_type,
      slug: result.slug, regionCode: result.region_code
    }
  });
});
