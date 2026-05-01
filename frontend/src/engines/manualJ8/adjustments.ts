/**
 * Manual J 8th Edition — Page-384 Adjustments
 * ============================================
 * Source: ACCA Manual J 8th Edition v2.50, page 384 (Table 4B Notes)
 *
 * Adjustments to color-corrected CLTD values for non-standard conditions:
 *   - Outdoor design temp ≠ 95°F
 *   - Daily range ≠ Medium (the L/M/H columns in Table 4B already encode
 *     this, but Figure A12-8 base values need manual DR adjustment)
 *   - Wall color (medium = 1.0, dark = ×0.65, light = use Figure A12-8 base)
 *   - Externally shaded walls — use the North CLTD value (lowest exposure)
 *
 * Note: For walls computed via Table 4B (medium-color baseline), the daily
 * range adjustment is already baked into the L/M/H columns and should NOT
 * be re-applied. These adjustments apply to the Figure A12-8 base values
 * for dark/light walls that need manual color correction.
 */

import type { AdjustmentContext, DailyRange } from './types';

/** Manual J page-384 note 3 — color correction multiplier applied to the
 *  Figure A12-8 base CLTD before adding outdoor temp / DR adjustments. */
export function colorMultiplier(color: AdjustmentContext['color']): number {
  switch (color) {
    case 'medium': return 1.00;
    case 'dark':   return 0.65;
    case 'light':  return 1.00;  // Use Figure A12-8 base directly, no multiplier
    default:       return 1.00;
  }
}

/** Outdoor design temp adjustment: if T_design > 95°F, add the difference
 *  to the color-adjusted CLTD; if T_design < 95°F, subtract the difference. */
export function outdoorTempAdjustment(outdoorDesignDB: number): number {
  return outdoorDesignDB - 95;
}

/** Daily range adjustment for Figure A12-8 base values:
 *  Low DR  → +4°F, High DR → −5°F, Medium → no change. */
export function dailyRangeAdjustment(dr: DailyRange): number {
  switch (dr) {
    case 'L': return  4;
    case 'M': return  0;
    case 'H': return -5;
  }
}

/** Apply all page-384 adjustments to a Figure A12-8 base CLTD. NOTE: This
 *  is NOT used on Table 4B values, which are already medium-color and
 *  already encode the DR via the L/M/H column structure.
 *
 *  Use this only when a wall's color is dark/light and you started from a
 *  Figure A12-8 base value. */
export function applyAdjustments(
  baseCLTD: number,
  ctx: AdjustmentContext,
): number {
  const colorAdjusted = baseCLTD * colorMultiplier(ctx.color);
  const tempAdjusted  = colorAdjusted + outdoorTempAdjustment(ctx.outdoorDesignDB);
  const drAdjusted    = tempAdjusted + dailyRangeAdjustment(ctx.dailyRange);
  return drAdjusted;
}

/** Return true if this wall should use the North CLTD (page-384 note 1):
 *  externally shaded walls receive no direct solar gain. */
export function shouldUseNorthCLTD(ctx: AdjustmentContext): boolean {
  return ctx.externallyShaded;
}
