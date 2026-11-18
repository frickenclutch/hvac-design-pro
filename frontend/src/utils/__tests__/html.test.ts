import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../html';

describe('escapeHtml', () => {
  it('neutralises markup in a project name', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<');
  });

  it('escapes quotes so a value cannot break out of an attribute', () => {
    expect(escapeHtml(`" onmouseover="x`)).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml(`it's`)).toBe('it&#39;s');
  });

  it('escapes ampersands first, without double-escaping', () => {
    expect(escapeHtml('Smith & Sons <HVAC>')).toBe('Smith &amp; Sons &lt;HVAC&gt;');
  });

  it('stringifies non-strings and treats null/undefined as empty', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves ordinary names untouched', () => {
    expect(escapeHtml('Living Room 2')).toBe('Living Room 2');
  });
});
