/**
 * Lightweight rate limiting backed by D1.
 *
 * Uses an append-only `rate_limit_events` table. Rows older than 1 hour
 * are cleaned up opportunistically via `cleanupRateLimitEvents`.
 */

import { generateId } from './id';

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number | null;
}

/**
 * Check whether the given identifier + action is within its rate limit window.
 */
export async function checkRateLimit(
  db: D1Database,
  identifier: string,
  action: string,
  maxAttempts: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt, MIN(created_at) as oldest
       FROM rate_limit_events
       WHERE identifier = ? AND action = ? AND created_at > ?`,
    )
    .bind(identifier, action, windowStart)
    .first<{ cnt: number; oldest: string | null }>();

  const count = row?.cnt ?? 0;

  if (count >= maxAttempts) {
    // Calculate retry-after from the oldest event in the window
    const oldestMs = row?.oldest ? new Date(row.oldest).getTime() : Date.now();
    const windowEndMs = oldestMs + windowMinutes * 60 * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: null };
}

/**
 * Record a rate-limit event (call after a failed attempt).
 */
export async function recordRateLimitEvent(
  db: D1Database,
  identifier: string,
  action: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO rate_limit_events (id, identifier, action) VALUES (?, ?, ?)')
    .bind(generateId(), identifier, action)
    .run();
}

/**
 * Delete rate-limit events older than the given threshold.
 * Call inside `waitUntil` so it never blocks the response.
 */
export async function cleanupRateLimitEvents(
  db: D1Database,
  olderThanMinutes = 60,
): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM rate_limit_events WHERE created_at < ?').bind(cutoff).run();
}
