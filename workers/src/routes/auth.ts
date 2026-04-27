import { Hono } from 'hono';
import { generateId } from '../utils/id';
import { hashPassword, verifyPassword, isLegacyHash } from '../utils/crypto';
import { sendEmail, buildWelcomeEmail, buildVerificationEmail, buildPasswordResetEmail } from '../utils/email';
import { createVerificationCode, validateVerificationCode } from '../utils/verificationCodes';
import { checkRateLimit, recordRateLimitEvent, cleanupRateLimitEvents } from '../utils/rateLimit';
import { buildAuthUrl, exchangeCodeForTokens, fetchMicrosoftProfile, buildCfAccessAuthUrl, exchangeCfAccessCode, fetchCfAccessUserInfo } from '../utils/oauth';

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
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.org_id,
            u.password_hash,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(normalizedEmail).first();

  if (!user || !user.password_hash) {
    await recordRateLimitEvent(db, normalizedEmail, 'login');
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash as string);
  if (!valid) {
    await recordRateLimitEvent(db, normalizedEmail, 'login');
    return c.json({ error: 'Invalid credentials' }, 401);
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
      lastName: user.last_name, role: user.role, isVerified: true,
      isPlatformAdmin: Number(user.is_platform_admin ?? 0) === 1,
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
  const token = generateId() + '-' + generateId();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const batchOps = [
    db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').bind(result.userId),
    db.prepare(
      'INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, (SELECT org_id FROM users WHERE id = ?), ?, ?)'
    ).bind(sessionId, result.userId, result.userId, token, expiresAt),
  ];

  await db.batch(batchOps);

  // Fetch full user + org data for the response
  const userData = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_platform_admin, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.id = ?`
  ).bind(result.userId).first();

  if (!userData) return c.json({ error: 'User not found' }, 500);

  // Send welcome email (fire-and-forget)
  const welcomeEmail = buildWelcomeEmail(userData.first_name as string);
  welcomeEmail.to = normalizedEmail;
  c.executionCtx.waitUntil(sendEmail(c.env.RESEND_API_KEY, welcomeEmail));

  return c.json({
    token,
    user: {
      id: userData.id, email: userData.email, firstName: userData.first_name,
      lastName: userData.last_name, role: userData.role, isVerified: true,
      isPlatformAdmin: Number(userData.is_platform_admin ?? 0) === 1,
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
  ]);

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
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(email).first();

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
  const token = generateId() + '-' + generateId();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    'INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, orgId, token, expiresAt).run();

  return c.json({
    token,
    user: {
      id: userId, email, firstName: userFirstName,
      lastName: userLastName, role: userRole, isVerified: true,
      isPlatformAdmin,
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
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.org_id,
            o.name as org_name, o.org_type, o.slug, o.region_code
     FROM users u JOIN organisations o ON o.id = u.org_id
     WHERE u.email = ?`
  ).bind(email).first();

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
  const token = generateId() + '-' + generateId();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    'INSERT INTO sessions (id, user_id, org_id, token, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, orgId, token, expiresAt).run();

  return c.json({
    token,
    user: {
      id: userId, email, firstName: userFirstName,
      lastName: userLastName, role: userRole, isVerified: true,
      isPlatformAdmin,
    },
    organisation: {
      id: orgId, name: orgName, type: orgType,
      slug: orgSlug, regionCode
    }
  });
});

// ── Logout ───────────────────────────────────────────────────────────────────
authRoutes.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return c.json({ ok: true });
});

// ── Get current session user ─────────────────────────────────────────────────
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);

  const token = authHeader.slice(7);
  const db = c.env.DB;

  const result = await db.prepare(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_verified, u.is_platform_admin, u.org_id,
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
      lastName: result.last_name, role: result.role, isVerified: !!result.is_verified,
      isPlatformAdmin: Number(result.is_platform_admin ?? 0) === 1,
    },
    organisation: {
      id: result.org_id, name: result.org_name, type: result.org_type,
      slug: result.slug, regionCode: result.region_code
    }
  });
});
