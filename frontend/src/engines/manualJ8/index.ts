/**
 * Manual J 8th Edition v2.50 — Public API
 * =========================================
 * Cert-grade load calculation engine, validated against three ACCA reference
 * test cases (Smith / Walker / Cobb) at 184/184 line-item checks within 0.5%.
 *
 * This module is independent of the legacy `engines/manualJ.ts`. Both engines
 * coexist; UIs opt into the cert-grade pipeline by importing from here.
 *
 * Quick start:
 *
 *   import { buildFormJ1, getConstruction } from './engines/manualJ8';
 *
 *   const result = buildFormJ1({
 *     conditions: { ... },
 *     windows: [ ... ],
 *     // ... rest of FormJ1Input
 *   });
 *
 *   console.log(`Total heating: ${result.total.heat} Btuh`);
 *   console.log(`SHR: ${result.sensibleHeatRatio}`);
 */

// Public types
export type {
  // Climate
  DesignConditions,
  DailyRange,
  // Tables
  WallGroup,
  CTDBin,
  CLTDCell,
  Table4BData,
  // Constructions
  ConstructionVariant,
  ConstructionKind,
  ReferenceArea,
  // Adjustments
  AdjustmentContext,
  WallColor,
  // Worksheet inputs
  WindowInput,
  SkylightInput,
  OpaqueInput,
  InfiltrationInput,
  InfiltrationMethod,
  InternalLoadsInput,
  CustomAppliance,
  DuctInput,
  VentilationInput,
  AncillaryInput,
  // Worksheet results
  WindowResult,
  SkylightResult,
  OpaqueResult,
  InfiltrationResult,
  InternalLoadsResult,
  DuctFactors,
  VentilationResult,
  AncillaryResult,
  // Form J1
  FormJ1Input,
  FormJ1LineItem,
  FormJ1Result,
} from './types';

// Tables
export { TABLE_4B } from './tables/table4B';
export { DOORS, DOOR_DIRECT_CLTD } from './tables/doors';
export {
  getConstruction,
  listConstructions,
  basementWallUAtDepth,
  REGISTRY_SIZE,
} from './tables/constructions';

// Lookup
export {
  lookupWallCLTD,
  lookupPartitionCLTD,
  lookupDoorCLTD,
  lookupDirectCLTD,
  lookupFloorPTD,
} from './lookup';

// Adjustments
export {
  applyAdjustments,
  colorMultiplier,
  outdoorTempAdjustment,
  dailyRangeAdjustment,
  shouldUseNorthCLTD,
} from './adjustments';

// Worksheets
export {
  windowHeatHTM,
  windowCoolHTM_D,
  windowAHTM_D,
  windowAHTM_N,
  windowHTM_SS,
  windowHTM_OH,
  calculateWindow,
} from './worksheets/windows';

export {
  curbUValue,
  shaftUValue,
  panelArea,
  curbArea,
  shaftArea,
  skylightUeff,
  skylightCoolHTM,
  calculateSkylight,
} from './worksheets/skylights';

export { calculateOpaque } from './worksheets/opaque';

export {
  spaceICFMfromACH,
  spaceICFMfromELA,
  netInfiltrationCFM,
  infiltrationHeatLoad,
  infiltrationSensLoad,
  infiltrationLatentLoad,
  calculateInfiltration,
} from './worksheets/infiltration';

export { calculateInternalLoads } from './worksheets/internal';
export { calculateDuctFactors } from './worksheets/ducts';
export {
  hrvLATloss,
  hrvLATgain,
  calculateVentilation,
} from './worksheets/ventilation';
export {
  humidificationLoad,
  blowerHeatLoad,
  calculateAncillary,
} from './worksheets/ancillary';

// Form J1 aggregator
export { buildFormJ1 } from './formJ1';

/**
 * Engine version stamp — embedded in calculation records for audit
 * traceability. Bump when the engine logic changes in a way that affects
 * outputs. See database schema's `calculations.engine_version` column.
 *
 * 1.2.0 (2026-07-15): ceiling CLTD family rows 16B/16C/16D transcribed from
 * the physical book (Table 4A pp. 362-363).
 *   · Climates that previously THREW (CTD bins 15/H, 20/*, 25/*, 30/H, 35/H
 *     beyond the anchors) now resolve to the printed cells.
 *   · OUTPUT CORRECTION for CTD ≤ 10 demands on 16B-30ad (DR=M), 16C-38aw
 *     and 16DR-38aw (DR=L): under the old single-cell matrices these fell
 *     through the EMPTY bin 10 into the bin-15 anchor (50 / 44 / 34) via the
 *     round-up convention; with bin 10 now populated they resolve to the
 *     book's printed bin-10 values (45 / 39 / 25+... = 45/39/29), i.e. 5
 *     LOWER. The old values were sparse-matrix fall-through artifacts, not
 *     book values — marine/cool-climate (SF/Seattle-class) shadow runs will
 *     show a small downward heat-gain step across the 1.1.0→1.2.0 stamp.
 *   · All cert-anchored cells are embedded unchanged; Smith (CTD=15), Walker
 *     (CTD=15) and Cobb (CTD=18) resolve identically — 184/184 unaffected,
 *     so the 1.1.0 ACCA filing remains valid for the reference climates.
 *
 * 1.2.1 (2026-07-15): 16F family row transcribed from Table 4A p. 364 —
 * completes the last registry ceiling (16F-38tw, Walker's white-tile
 * selection; anchor 15/L=19 matched the printed row exactly). Same
 * correction class as 1.2.0 for CTD ≤ 10 / DR=L on 16F: previously fell
 * through the empty bin 10 into the anchor (19), now resolves to the
 * printed bin-10 cell (14). All four registry ceilings now carry complete
 * book rows; cert anchors unchanged, 184/184 unaffected.
 *
 * 1.3.0 (2026-07-15): Construction 19 floor PTD tables — climate-dependent.
 * The 19B sealed/passive block (Table 4A, R-4 exposed walls) transcribed
 * from the book; floors now look PTDH up by design HTD and PTDC by CTD,
 * replacing the FIXED reference-point values that were book-true only at
 * Smith's design conditions. Lookup convention is PRINTED-COLUMN-FIRST:
 * the nearest printed column's value when within the ACCA 5% threshold of
 * the linear interpolation, interpolated only beyond it (rule-1 mandate,
 * bites at low TD). This is anchored to the book's own worked Smith
 * example — Smith runs at HTD 76 and the Form J1 uses the printed
 * 75-column value 6.6 (deviation ~1.5% ≤ 5%), so Smith resolves
 * BIT-IDENTICALLY to the fixed-value era and the 184/184 reference checks
 * are unchanged. OUTPUT CORRECTION for crawl-floor calcs whose design
 * conditions differ from Smith's: mild climates go down (HTD 40: 6.6 →
 * 3.5), cold climates go up (HTD 85: 6.6 → 7.5). The legacy adapter also
 * now maps floorRValue to the matching 19B row (19B-2sp..38sp) instead of
 * treating every crawl floor as uninsulated — insulated-floor homes see a
 * large book-correcting HTM reduction.
 */
export const MANUAL_J8_ENGINE_VERSION = 'manualJ8-ts-1.3.0';
