export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Derive a unique organisations.slug from a display name. The column is
 * UNIQUE, but org NAMES are not — two "Smith HVAC" companies must both be
 * able to register. Without this, the INSERT threw a raw UNIQUE-constraint
 * exception on any name collision and registration surfaced as a fake
 * network error. On collision we append a short random suffix; the loop
 * retries with a fresh suffix in the (vanishing) case that one collides too.
 */
export async function uniqueOrgSlug(db: D1Database, base: string): Promise<string> {
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'org';
  let candidate = root;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await db.prepare('SELECT 1 FROM organisations WHERE slug = ?').bind(candidate).first();
    if (!taken) return candidate;
    candidate = `${root}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // Five random collisions in a row is effectively impossible; fall back to
  // a UUID fragment which is unique by construction.
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}
