// Placement of the tenant mark on a report page. Kept in its own module —
// free of stores and the DOM — so it is unit-testable in a bare Node run.

/** Where the mark goes, in points. It sits in the top strip (y 12–28pt), on
 *  the right unless the user's firm stamp occupies the top-right corner, in
 *  which case it moves left so the two never touch. Pure. */
export function brandMarkLayout(
  pageWidthPt: number,
  logoAspect: number | null,
  nameWidthPt: number,
  side: 'left' | 'right' = 'right',
) {
  const EDGE = 40;       // matches the narrowest report margin
  const LOGO_H = 16;
  const TOP = 12;        // spans y 12–28pt; content starts ≥ 50pt, stamps ≥ 30pt
  const GAP = 6;
  const logoW = logoAspect ? Math.min(LOGO_H * logoAspect, 90) : 0;
  const lead = logoW ? logoW + GAP : 0;
  const logoX = side === 'right' ? pageWidthPt - EDGE - nameWidthPt - lead : EDGE;
  return { nameX: logoX + lead, nameBaseline: TOP + 12, logoX, logoY: TOP, logoW, logoH: LOGO_H };
}
