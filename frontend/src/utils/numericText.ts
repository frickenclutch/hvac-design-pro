/**
 * Text ⇄ number helpers for numeric form fields.
 *
 * `Number('')` is 0 and `Number(' ')` is 0, which is how an emptied field used
 * to become a silent zero in the calculators. These helpers treat "nothing
 * usable typed yet" as null instead.
 */

/** Parse a field's text. Returns null for empty, partial ("-", ".") or non-numeric text. */
export function parseNumericText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Text to show for a stored value: empty for anything that is not a finite number. */
export function formatNumericValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** True when `text` already represents `value` (so the field need not be rewritten). */
export function numericTextMatches(text: string, value: unknown): boolean {
  const parsed = parseNumericText(text);
  if (parsed === null) return !(typeof value === 'number' && Number.isFinite(value));
  return parsed === value;
}
