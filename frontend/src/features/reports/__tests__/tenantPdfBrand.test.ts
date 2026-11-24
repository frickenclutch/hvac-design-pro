import { describe, it, expect } from 'vitest';
import { brandMarkLayout } from '../brandMarkLayout';

// Letter portrait is 612pt wide. Report content starts at y ≥ 50pt and a
// top-positioned firm stamp at y ≥ 30pt, so the mark must stay inside 0–30pt.
describe('tenantPdfBrand.brandMarkLayout', () => {
  it('sits in the free top strip', () => {
    const m = brandMarkLayout(612, 3, 60);
    expect(m.logoY).toBeGreaterThanOrEqual(10);
    expect(m.logoY + m.logoH).toBeLessThanOrEqual(30);
    expect(m.nameBaseline).toBeLessThanOrEqual(30);
  });

  it('right side: ends at the right margin, logo before the name', () => {
    const m = brandMarkLayout(612, 3, 60);
    expect(m.nameX + 60).toBeCloseTo(612 - 40);
    expect(m.logoX + m.logoW).toBeLessThan(m.nameX);
    expect(m.logoX).toBeGreaterThan(0);
  });

  it('left side: starts at the left margin', () => {
    const m = brandMarkLayout(612, 3, 60, 'left');
    expect(m.logoX).toBe(40);
    expect(m.nameX).toBeGreaterThan(m.logoX + m.logoW);
  });

  it('caps a very wide logo and handles no logo at all', () => {
    expect(brandMarkLayout(612, 20, 60).logoW).toBe(90);
    const none = brandMarkLayout(612, null, 60);
    expect(none.logoW).toBe(0);
    expect(none.nameX).toBeCloseTo(612 - 40 - 60);
  });
});
