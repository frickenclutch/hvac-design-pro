/**
 * Manual J 8th Edition — Worksheet D (Opaque Panels)
 * ====================================================
 * Source: ACCA Manual J 8th Edition v2.50, Worksheet D
 *
 * Computes HTMs and Btuh loads for opaque elements: doors, walls (above-grade,
 * partition, below-grade), ceilings, floors (over crawl/exposed), and slabs.
 *
 * Each path uses different temp differentials:
 *   - Exterior:  HTD / CLTD (with solar)
 *   - Partition: PTDH / PTDC (between conditioned & buffer space, no solar)
 *   - Slab:      F-value × HTD × exposed-edge-feet
 *   - Radiant:   F-value × (HTD + 25)
 *   - Below-grade: depth-dependent U-value × HTD
 */

import type {
  ConstructionVariant, DailyRange, OpaqueInput, OpaqueResult,
} from '../types';
import { getConstruction, basementWallUAtDepth } from '../tables/constructions';
import {
  lookupDoorCLTD, lookupWallCLTD, lookupPartitionCLTD, lookupDirectCLTD,
  lookupFloorPTD,
} from '../lookup';

/** Look up the cooling temp differential to apply for a given construction
 *  in a given role (exterior / partition / etc). Returns the CLTD or PTDC. */
function coolingDelta(
  c: ConstructionVariant,
  ctd: number,
  dr: DailyRange,
  asPartition: boolean,
  ptdcOverride?: number,
): number {
  // Explicit override (Smith partition uses PTDC from a referenced construction)
  if (asPartition && ptdcOverride !== undefined) return ptdcOverride;
  // Doors use direct CLTD from Construction 11
  if (c.kind === 'door') {
    return lookupDoorCLTD(ctd, dr);
  }
  // Direct-CLTD constructions (doors and ceilings — both published in
  // Table 4A; ceiling family rows live on pp. 362-364, source-verified
  // 2026-07-15). Attribute any data-gap throw to the specific element so
  // the cutover cockpit can name exactly which construction and which
  // (CTD, DR) cell is missing from the encoded matrix.
  if (c.directCLTD) {
    return lookupDirectCLTD(
      c.directCLTD, ctd, dr,
      `Manual J Table 4A (${c.kind} "${c.id}")`,
    );
  }
  // Construction 19 floors: climate-dependent PTDC row (Table 4A pp.
  // 371-377; a function of CTD only — the printed cells span the DR
  // sub-columns). Applies to the floor itself AND when it serves as the
  // partition reference. Supersedes the fixed reference-point ptdc.
  if (c.ptdcByCtd) {
    return lookupFloorPTD(
      c.ptdcByCtd, ctd,
      `Manual J Table 4A (${c.kind} "${c.id}" PTDC)`,
    );
  }
  // Partition path (use PTDC)
  if (asPartition && c.ptdc !== undefined) {
    return c.ptdc;
  }
  // Group-based wall lookup
  if (c.group) {
    return asPartition
      ? lookupPartitionCLTD(c.group, ctd, dr)
      : lookupWallCLTD(c.group, ctd, dr);
  }
  // Slabs and radiant floors have no cooling load contribution
  if (c.kind === 'slab') return 0;
  // Below-grade walls: no cooling load (ground-temperature dampened)
  if (c.kind === 'basement_wall' && !asPartition) return 0;
  // Heat-only floors (basement-area floors with neither PTDC nor Group —
  // e.g. Smith's 21A-32 workshop floor at U=0.020). The cert reference
  // shows zero cooling load for these. Ground-temperature dampened.
  if (c.kind === 'floor' && c.ptdc === undefined && !c.group) return 0;

  throw new Error(
    `Cannot derive cooling delta for construction "${c.id}" — needs ` +
    `directCLTD, group, or partition treatment.`,
  );
}

/** Heating temp differential for a construction. Uses HTD for exterior,
 *  PTDH for partitions, (HTD + 25) for radiant slabs. */
function heatingDelta(
  c: ConstructionVariant,
  htd: number,
  asPartition: boolean,
  ptdhOverride?: number,
): number {
  // Explicit override takes precedence (e.g. Smith partition referencing
  // Construction 19B-osp's PTDH per Worksheet D Note 4)
  if (asPartition && ptdhOverride !== undefined) return ptdhOverride;
  // Construction 19 floors: climate-dependent PTDH row (Table 4A pp.
  // 371-377), linearly interpolated at the design HTD. Supersedes the
  // fixed reference-point ptdh, which was only book-true at the cert
  // reference climate (Smith: HTD 75 → 6.6).
  if (c.ptdhByHtd) {
    return lookupFloorPTD(
      c.ptdhByHtd, htd,
      `Manual J Table 4A (${c.kind} "${c.id}" PTDH)`,
    );
  }
  if (asPartition && c.ptdh !== undefined) return c.ptdh;
  if (c.kind === 'floor' && c.ptdh !== undefined) return c.ptdh;  // floor over crawl
  if (c.radiant) return htd + 25;
  return htd;
}

/** Effective U-value (or F-value for slabs) for the heating calc. */
function effectiveU(c: ConstructionVariant, depthFt?: number): number {
  if (c.kind === 'slab' && c.fValue !== undefined) return c.fValue;
  if (c.kind === 'basement_wall' && depthFt !== undefined) {
    return basementWallUAtDepth(c, depthFt);
  }
  return c.uValue;
}

/** Calculate heating and cooling HTMs + Btuh loads for one opaque element. */
export function calculateOpaque(
  input: OpaqueInput,
  ctd: number,
  htd: number,
  dr: DailyRange,
): OpaqueResult {
  const c = getConstruction(input.constructionId);
  if (!c) {
    throw new Error(
      `Construction "${input.constructionId}" not found in registry. ` +
      `Available: see frontend/src/engines/manualJ8/tables/constructions.ts`,
    );
  }

  const asPartition = input.asPartition ?? false;

  // Heating side
  const heatingU = effectiveU(c, input.basementFloorDepthFt);
  const heatingTD = heatingDelta(c, htd, asPartition, input.ptdhOverride);
  const htmHeating = heatingU * heatingTD;

  // Cooling side — slabs and below-grade walls have no cooling contribution
  let htmCooling = 0;
  if (
    c.kind !== 'slab' &&
    !(c.kind === 'basement_wall' && !asPartition && input.basementFloorDepthFt !== undefined)
  ) {
    const coolU = c.uValue;             // Cooling always uses above-grade U
    const cltd = coolingDelta(c, ctd, dr, asPartition, input.ptdcOverride);
    htmCooling = coolU * cltd;
  }

  return {
    htmHeating,
    htmCooling,
    heatLoad: htmHeating * input.area,
    sensLoad: htmCooling * input.area,
  };
}
