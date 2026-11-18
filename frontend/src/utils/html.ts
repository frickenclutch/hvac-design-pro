/**
 * Escape a value for interpolation into an HTML string.
 *
 * React escapes everything it renders, so this is only for the few places
 * that build raw HTML by hand — the `window.open()` + `document.write()`
 * print fallbacks. Those windows are same-origin with the app, so an
 * unescaped project or room name there is script execution with access to
 * the session in localStorage. Every non-constant value written into such a
 * template MUST go through this.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
