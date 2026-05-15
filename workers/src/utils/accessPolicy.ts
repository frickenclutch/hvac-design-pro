/**
 * Per-tenant access policy for compliance/forensic surfaces.
 *
 * Three capabilities are gated, each by a minimum-role threshold the
 * tenant admin (or L0) configures. Defaults implement "Option C":
 *
 *   - versionView   : who can list/preview CAD version history.
 *                      Default `viewer` → everyone with org access. The
 *                      version trail is the user's own work; seeing it
 *                      isn't a privilege escalation.
 *   - versionRestore: who can roll the live drawing back to a prior
 *                      version. Default `admin` → destructive, overwrite-
 *                      the-canvas action stays with admins + L0.
 *   - auditView     : who can open the audit-log surfaces (the page +
 *                      per-entity activity modals). Default `admin` →
 *                      it's an oversight/compliance tool, not a working
 *                      tool. Below threshold the endpoints 403 entirely
 *                      (they do NOT silently degrade to "your own rows").
 *
 * L0 (`is_platform_admin`) ALWAYS satisfies every threshold regardless
 * of the configured policy — the platform owner can see and do anything
 * for support + incident response. The tenant admin decides the policy
 * for their own org; L0 can override any org's policy.
 *
 * Storage: merged into organisations.settings JSON under `accessPolicy`.
 * Other settings keys are preserved on write.
 */

export type RoleName = 'viewer' | 'tech' | 'engineer' | 'admin';

/** Strict hierarchy. Higher number = more privilege. A user satisfies a
 *  threshold when their rank >= the threshold's rank (or they're L0). */
const ROLE_RANK: Record<RoleName, number> = {
  viewer: 0,
  tech: 1,
  engineer: 2,
  admin: 3,
};

export interface AccessPolicy {
  versionView: RoleName;
  versionRestore: RoleName;
  auditView: RoleName;
}

/** Option C defaults. */
export const DEFAULT_ACCESS_POLICY: AccessPolicy = {
  versionView: 'viewer',
  versionRestore: 'admin',
  auditView: 'admin',
};

const POLICY_KEYS: (keyof AccessPolicy)[] = ['versionView', 'versionRestore', 'auditView'];

function isRoleName(v: unknown): v is RoleName {
  return v === 'viewer' || v === 'tech' || v === 'engineer' || v === 'admin';
}

/** Parse the org's settings JSON (string or object) and merge any stored
 *  accessPolicy over the defaults. Unknown / malformed values fall back
 *  to the default for that key — never throw, never leave a key unset. */
export function resolveAccessPolicy(settings: unknown): AccessPolicy {
  let parsed: Record<string, unknown> = {};
  if (typeof settings === 'string' && settings.trim()) {
    try { parsed = JSON.parse(settings) as Record<string, unknown>; } catch { parsed = {}; }
  } else if (settings && typeof settings === 'object') {
    parsed = settings as Record<string, unknown>;
  }

  const stored = (parsed.accessPolicy ?? {}) as Record<string, unknown>;
  const result: AccessPolicy = { ...DEFAULT_ACCESS_POLICY };
  for (const k of POLICY_KEYS) {
    if (isRoleName(stored[k])) {
      result[k] = stored[k] as RoleName;
    }
  }
  return result;
}

/** Validate + normalize an incoming policy patch. Returns only the keys
 *  that were present AND valid; callers merge this over the resolved
 *  policy so a partial PUT only changes what was sent. */
export function sanitizeAccessPolicyPatch(body: unknown): Partial<AccessPolicy> {
  const out: Partial<AccessPolicy> = {};
  if (!body || typeof body !== 'object') return out;
  const b = body as Record<string, unknown>;
  for (const k of POLICY_KEYS) {
    if (k in b && isRoleName(b[k])) {
      out[k] = b[k] as RoleName;
    }
  }
  return out;
}

/** Merge an accessPolicy object back into a settings JSON, preserving
 *  every other settings key. Returns a JSON string ready for the
 *  organisations.settings column. */
export function mergeAccessPolicyIntoSettings(
  existingSettings: unknown,
  policy: AccessPolicy,
): string {
  let parsed: Record<string, unknown> = {};
  if (typeof existingSettings === 'string' && existingSettings.trim()) {
    try { parsed = JSON.parse(existingSettings) as Record<string, unknown>; } catch { parsed = {}; }
  } else if (existingSettings && typeof existingSettings === 'object') {
    parsed = existingSettings as Record<string, unknown>;
  }
  parsed.accessPolicy = policy;
  return JSON.stringify(parsed);
}

/** Does this actor satisfy the threshold? L0 always passes. */
export function roleSatisfies(
  userRole: string,
  threshold: RoleName,
  isPlatformAdmin: boolean,
): boolean {
  if (isPlatformAdmin) return true;
  const userRank = ROLE_RANK[userRole as RoleName];
  if (userRank === undefined) return false; // unknown role → deny
  return userRank >= ROLE_RANK[threshold];
}

export interface PolicyCapabilities {
  canViewVersions: boolean;
  canRestoreVersions: boolean;
  canViewAudit: boolean;
  /** True when the caller may edit the policy itself (tenant admin or L0). */
  canEditPolicy: boolean;
}

/** Resolve the caller's concrete yes/no capabilities so the frontend
 *  doesn't have to replicate the role-rank math. */
export function capabilitiesFor(
  user: { role: string; isPlatformAdmin: boolean },
  policy: AccessPolicy,
): PolicyCapabilities {
  return {
    canViewVersions: roleSatisfies(user.role, policy.versionView, user.isPlatformAdmin),
    canRestoreVersions: roleSatisfies(user.role, policy.versionRestore, user.isPlatformAdmin),
    canViewAudit: roleSatisfies(user.role, policy.auditView, user.isPlatformAdmin),
    canEditPolicy: user.role === 'admin' || user.isPlatformAdmin,
  };
}
