/**
 * Microsoft Entra ID (Azure AD) OAuth 2.0 Authorization Code Flow.
 *
 * Uses the "common" endpoint for multi-tenant + personal Microsoft accounts.
 * Scopes: openid, profile, email — sufficient for authentication and
 * fetching basic user info from Microsoft Graph.
 */

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

const REDIRECT_URI_PROD = 'https://hvac-design-pro.pages.dev/auth/callback';
const REDIRECT_URI_DEV = 'http://localhost:5173/auth/callback';

export interface MicrosoftProfile {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  givenName: string | null;
  surname: string | null;
}

/**
 * Build the Microsoft authorize URL that the frontend redirects to.
 */
export function buildAuthUrl(clientId: string, state: string, isDev = false): string {
  const redirectUri = isDev ? REDIRECT_URI_DEV : REDIRECT_URI_PROD;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    prompt: 'select_account',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange the authorization code for access + ID tokens.
 */
export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  code: string,
  isDev = false,
): Promise<{ access_token: string; id_token: string; token_type: string; expires_in: number }> {
  const redirectUri = isDev ? REDIRECT_URI_DEV : REDIRECT_URI_PROD;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: 'openid profile email',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Fetch the authenticated user's profile from Microsoft Graph.
 */
export async function fetchMicrosoftProfile(accessToken: string): Promise<MicrosoftProfile> {
  const res = await fetch(GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API failed (${res.status}): ${err}`);
  }

  return res.json();
}

// ── Cloudflare Access OIDC ──────────────────────────────────────────────────

export interface CfAccessUserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

/**
 * Build the Cloudflare Access authorize URL.
 */
export function buildCfAccessAuthUrl(
  issuer: string,
  clientId: string,
  state: string,
  isDev = false,
): string {
  const redirectUri = isDev ? REDIRECT_URI_DEV : REDIRECT_URI_PROD;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid email profile groups',
    state,
  });
  return `${issuer}/authorization?${params.toString()}`;
}

/**
 * Exchange a Cloudflare Access authorization code for tokens.
 */
export async function exchangeCfAccessCode(
  issuer: string,
  clientId: string,
  clientSecret: string,
  code: string,
  isDev = false,
): Promise<{ access_token: string; id_token: string }> {
  const redirectUri = isDev ? REDIRECT_URI_DEV : REDIRECT_URI_PROD;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF Access token exchange failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Fetch user info from Cloudflare Access userinfo endpoint.
 */
export async function fetchCfAccessUserInfo(
  issuer: string,
  accessToken: string,
): Promise<CfAccessUserInfo> {
  const res = await fetch(`${issuer}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF Access userinfo failed (${res.status}): ${err}`);
  }

  return res.json();
}
