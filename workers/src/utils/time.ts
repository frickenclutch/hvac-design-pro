/**
 * Expiry-comparison helper.
 *
 * Every expires_at we WRITE is a JS ISO-8601 string ("2026-07-15T14:00:00.000Z"),
 * but historically the checks compared it against SQLite's datetime('now')
 * ("2026-07-15 14:00:00"). Those formats differ at position 10 ('T' vs ' ')
 * and 'T' > ' ' in a string comparison — so any same-UTC-day expiry silently
 * passed the check until the next day. A "30-minute" access token really
 * lived until UTC midnight.
 *
 * Fix: bind the CURRENT time as an ISO string and compare ISO-to-ISO.
 * Use `WHERE expires_at > ?` with nowIso() everywhere an ISO-written
 * expiry is checked. Never compare an ISO column to datetime('now').
 */
export function nowIso(): string {
  return new Date().toISOString();
}
