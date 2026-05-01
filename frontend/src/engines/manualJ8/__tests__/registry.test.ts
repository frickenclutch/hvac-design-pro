/**
 * Construction registry sanity tests — guards against accidental regressions
 * when the registry is expanded or refactored.
 *
 * The cert-grade validation lives in smith.test.ts / walker.test.ts /
 * cobb.test.ts and exercises the actual Manual J line-item math. This file
 * is a structural check: registry coverage, ID format consistency, that
 * critical entries used by the three reference test cases are present, etc.
 */

import { describe, it, expect } from 'vitest';
import {
  getConstruction,
  listConstructions,
  REGISTRY_SIZE,
  MANUAL_J8_ENGINE_VERSION,
} from '../index';

describe('Construction registry', () => {
  it('contains the entries used by the three ACCA reference test cases', () => {
    // Doors (Smith, Walker, Cobb)
    expect(getConstruction('11N')).toBeDefined();
    // Smith's walls + slab + ceiling + floor + partition
    expect(getConstruction('14A-8')).toBeDefined();
    expect(getConstruction('15A-4sffc-x')).toBeDefined();
    expect(getConstruction('16B-30ad')).toBeDefined();
    expect(getConstruction('19B-osp')).toBeDefined();
    expect(getConstruction('21A-32')).toBeDefined();
    expect(getConstruction('22B-5ph')).toBeDefined();
    // Walker (AAC walls + radiant slab + 3 ceiling options)
    expect(getConstruction('14C-5')).toBeDefined();
    expect(getConstruction('22D-5rl')).toBeDefined();
    expect(getConstruction('16F-38tw')).toBeDefined();
    expect(getConstruction('16DR-38aw')).toBeDefined();
    expect(getConstruction('16C-38aw')).toBeDefined();
    // Cobb (block walls + generic glass)
    expect(getConstruction('13Ca-0oc-m')).toBeDefined();
    expect(getConstruction('1D')).toBeDefined();
    expect(getConstruction('1E')).toBeDefined();
  });

  it('has critical Smith and Walker U-values + Group letters preserved', () => {
    expect(getConstruction('14A-8')!.uValue).toBe(0.091);
    expect(getConstruction('14A-8')!.group).toBe('H');
    expect(getConstruction('14C-5')!.uValue).toBe(0.069);
    expect(getConstruction('14C-5')!.group).toBe('K');
    expect(getConstruction('13Ca-0oc-m')!.uValue).toBe(0.123);
    expect(getConstruction('13Ca-0oc-m')!.group).toBe('I');
    expect(getConstruction('22B-5ph')!.fValue).toBe(0.589);
    expect(getConstruction('22D-5rl')!.fValue).toBe(0.287);
    expect(getConstruction('22D-5rl')!.radiant).toBe(true);
    expect(getConstruction('11N')!.uValue).toBe(0.35);
  });

  it('Smith basement wall has the depth-dependent below-grade U curve', () => {
    const c = getConstruction('15A-4sffc-x')!;
    expect(c.belowGradeUByDepth).toBeDefined();
    expect(c.belowGradeUByDepth!.find((p) => p.depthFt === 4)!.uValue).toBe(0.079);
    expect(c.belowGradeUByDepth!.find((p) => p.depthFt === 8)!.uValue).toBe(0.062);
  });

  it('every variant has a non-empty id and description', () => {
    for (const v of listConstructions()) {
      expect(v.id).toBeTruthy();
      expect(v.description).toBeTruthy();
      expect(v.kind).toBeTruthy();
    }
  });

  it('has no duplicate IDs in the registry', () => {
    const ids = listConstructions().map((v) => v.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('registry is materially expanded vs the v1.0 baseline (~50 entries)', () => {
    // v1.1 expansion target is ~400+ entries covering Constructions 11-15
    expect(REGISTRY_SIZE).toBeGreaterThan(300);
  });

  it('engine version is current', () => {
    expect(MANUAL_J8_ENGINE_VERSION).toBe('manualJ8-ts-1.1.0');
  });
});
