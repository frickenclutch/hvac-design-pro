import { describe, it, expect } from 'vitest';
import { reconcileDuctAssumptions, DUCT_DRIFT_THRESHOLD_PERCENT } from '../ductReconcile';

/** Runs are anything carrying actualLengthFt (D inputs or D results). */
const run = (actualLengthFt: number) => ({ actualLengthFt });

describe('reconcileDuctAssumptions', () => {
  it('returns null when there is no design to compare', () => {
    expect(reconcileDuctAssumptions(80, null)).toBeNull();
    expect(reconcileDuctAssumptions(80, undefined)).toBeNull();
    expect(reconcileDuctAssumptions(80, [])).toBeNull();
  });

  it('returns null when the design has no usable lengths', () => {
    expect(reconcileDuctAssumptions(80, [run(0), run(-5), run(NaN)])).toBeNull();
  });

  it('sums straight-run lengths and reports drift against the assumption', () => {
    const report = reconcileDuctAssumptions(80, [run(30), run(45), run(25)]);
    expect(report).not.toBeNull();
    expect(report!.designedLengthFt).toBe(100);
    expect(report!.assumedLengthFt).toBe(80);
    expect(report!.runCount).toBe(3);
    expect(report!.deltaFt).toBe(20);
    expect(report!.deltaPercent).toBe(25);
    expect(report!.exceedsThreshold).toBe(true);
    expect(report!.signature).toBe('80|100');
  });

  it('ignores non-finite and non-positive run lengths in the sum', () => {
    const report = reconcileDuctAssumptions(80, [run(50), run(NaN), run(-10), run(30)]);
    expect(report!.designedLengthFt).toBe(80);
    expect(report!.deltaFt).toBe(0);
    expect(report!.exceedsThreshold).toBe(false);
  });

  it('does not surface drift at or below the threshold', () => {
    // 15% exactly on an 80 ft assumption → 92 ft
    const atThreshold = reconcileDuctAssumptions(80, [run(92)]);
    expect(atThreshold!.deltaPercent).toBe(DUCT_DRIFT_THRESHOLD_PERCENT);
    expect(atThreshold!.exceedsThreshold).toBe(false);

    const justOver = reconcileDuctAssumptions(80, [run(93)]);
    expect(justOver!.exceedsThreshold).toBe(true);
  });

  it('reports signed shortfall when the design is shorter than assumed', () => {
    const report = reconcileDuctAssumptions(100, [run(60)]);
    expect(report!.deltaFt).toBe(-40);
    expect(report!.deltaPercent).toBe(40);
    expect(report!.exceedsThreshold).toBe(true);
  });

  it('always surfaces when Manual J has no usable baseline', () => {
    const report = reconcileDuctAssumptions(0, [run(75)]);
    expect(report!.assumedLengthFt).toBe(0);
    expect(report!.deltaPercent).toBeNull();
    expect(report!.exceedsThreshold).toBe(true);
    expect(report!.signature).toBe('0|75');
  });

  it('keeps the signature stable for identical comparisons', () => {
    const a = reconcileDuctAssumptions(80.4, [run(50.3), run(49.9)]);
    const b = reconcileDuctAssumptions(80.4, [run(50.3), run(49.9)]);
    expect(a!.signature).toBe(b!.signature);
  });
});
