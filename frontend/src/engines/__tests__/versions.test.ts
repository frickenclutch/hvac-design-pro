/**
 * Single-source-of-truth guard for engines/versions.ts (Unit N0).
 *
 * versions.ts is deliberately literal-only so lazy calculator chunks can
 * import it without dragging engine bundles in. That leaves two copies of the
 * manualJ8 / manualS version strings in the source tree — this test is what
 * makes them one: bump an engine's exported constant without updating the
 * map (or vice versa) and CI goes red.
 */
import { describe, it, expect } from 'vitest';
import { ENGINE_VERSIONS } from '../versions';
import { MANUAL_J8_ENGINE_VERSION } from '../manualJ8';
import { MANUAL_S_ENGINE_VERSION } from '../manualS';

describe('ENGINE_VERSIONS map', () => {
  it('matches the manualJ8 engine export', () => {
    expect(ENGINE_VERSIONS.manualJ8).toBe(MANUAL_J8_ENGINE_VERSION);
  });

  it('matches the manualS engine export', () => {
    expect(ENGINE_VERSIONS.manualS).toBe(MANUAL_S_ENGINE_VERSION);
  });

  it('pins the engines that have no module-level constant', () => {
    // These literals ARE the canonical version for their engines (the engine
    // files export no constant of their own). A bump must touch this test —
    // same discipline as the manualJ8 registry pin.
    expect(ENGINE_VERSIONS.manualJLegacy).toBe('manualJ-legacy-1.0');
    expect(ENGINE_VERSIONS.manualD).toBe('manualD-1.0');
    expect(ENGINE_VERSIONS.aed).toBe('aed-1.0');
  });
});
