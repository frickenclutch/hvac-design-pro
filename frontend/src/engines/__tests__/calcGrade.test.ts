/**
 * Grade taxonomy tests (Unit N0, spec §2).
 *
 * The stamp is a PERMANENT audit-record format — these tests pin its
 * derivation rules: grade is derived (never asserted), any grade-capping
 * assumption caps to budget-estimate, and commercial runs through
 * residential-methodology tooling always cap.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveGrade,
  buildGradeStamp,
  COMMERCIAL_J_APPROXIMATION,
  type Assumption,
} from '../calcGrade';

const infoAssumption: Assumption = {
  key: 'clf.unity',
  severity: 'info',
  message: 'CLF assumed 1.0',
  source: 'default',
};

const cappingAssumption: Assumption = {
  key: 'wb.approximated',
  severity: 'grade-capping',
  message: 'Coincident wet-bulb approximated',
  source: 'approximation',
};

describe('deriveGrade', () => {
  it('is permit-grade with no assumptions', () => {
    expect(deriveGrade([])).toBe('permit-grade');
  });

  it('stays permit-grade under info-severity assumptions', () => {
    expect(deriveGrade([infoAssumption])).toBe('permit-grade');
  });

  it('caps at budget-estimate on any grade-capping assumption', () => {
    expect(deriveGrade([infoAssumption, cappingAssumption])).toBe('budget-estimate');
  });
});

describe('buildGradeStamp', () => {
  it('residential Manual J stamps permit-grade', () => {
    const s = buildGradeStamp({ method: 'manualJ-residential', buildingType: 'residential' });
    expect(s.__grade).toBe('permit-grade');
    expect(s.__assumptions).toEqual([]);
    expect(s.__method).toBe('manualJ-residential');
  });

  it('commercial auto-appends the residential-approximation cap', () => {
    const s = buildGradeStamp({ method: 'manualJ-residential-approximation', buildingType: 'commercial' });
    expect(s.__grade).toBe('budget-estimate');
    expect(s.__assumptions).toContainEqual(COMMERCIAL_J_APPROXIMATION);
  });

  it('does not duplicate the cap when the caller already ledgered it', () => {
    const s = buildGradeStamp({
      method: 'manualJ-residential-approximation',
      buildingType: 'commercial',
      assumptions: [COMMERCIAL_J_APPROXIMATION],
    });
    expect(s.__assumptions.filter((a) => a.key === COMMERCIAL_J_APPROXIMATION.key)).toHaveLength(1);
  });

  it('unknown building type stamps permit-grade only when the ledger is clean', () => {
    expect(buildGradeStamp({ method: 'aed' }).__grade).toBe('permit-grade');
    expect(buildGradeStamp({ method: 'aed', assumptions: [cappingAssumption] }).__grade).toBe('budget-estimate');
  });

  it('does not auto-cap real Manual N commercial output (its own ledger decides)', () => {
    const s = buildGradeStamp({ method: 'manualN', buildingType: 'commercial' });
    expect(s.__assumptions).toEqual([]);
    expect(s.__grade).toBe('permit-grade');
  });

  it('caller assumptions merge ahead of the auto-cap', () => {
    const s = buildGradeStamp({
      method: 'manualJ-residential-approximation',
      buildingType: 'commercial',
      assumptions: [infoAssumption],
    });
    expect(s.__assumptions[0]).toEqual(infoAssumption);
    expect(s.__assumptions).toHaveLength(2);
    expect(s.__grade).toBe('budget-estimate');
  });
});
