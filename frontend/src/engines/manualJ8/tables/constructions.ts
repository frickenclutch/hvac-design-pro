/**
 * Manual J 8th Edition v2.50 — Construction Registry (Table 4A)
 * ==============================================================
 * Source: ACCA Manual J 8th Edition v2.50, pages 345-354
 *
 * Construction sub-type registry covering:
 *   11 — Wood and metal doors           (in tables/doors.ts, 17 sub-types)
 *   12 — Frame walls         (12A-12F, 144 variants, page 346-347)
 *   13 — Block walls         (13AA-13F, ~140 variants, page 348-351)
 *   14 — Alternative walls   (14A-14F, ~37 variants, page 352)
 *   15 — Basement walls      (15A board + framing, ~50 variants, page 353-354)
 *   16/17/18 — Ceilings      (validated entries used by Smith and Walker)
 *   19/20/21 — Floors        (Smith and Walker use cases)
 *   22 — Slab floors         (Smith and Walker use cases)
 *   1-10 — Generic glass     (Cobb's pre-NFRC fenestration)
 *
 * Each entry has been cross-validated against the source pages and against
 * the Smith / Walker / Cobb Form J1 published values where applicable.
 *
 * Compact data tables below mirror the book's tabular layout so a reviewer
 * can scan from the source page to the code one row at a time.
 */

import type { ConstructionVariant, WallGroup, CTDBin, CLTDCell, HTDColumn } from '../types';
import { DOORS } from './doors';

// ============================================================================
// Helper functions — expand compact tuples into typed ConstructionVariant
// ============================================================================

/**
 * Frame-wall variants (Construction 12). Each tuple expands to 4 entries
 * covering brick × wood, brick × metal, siding × wood, siding × metal.
 *
 * Tuple shape: [boardR, U_brick_wood, U_brick_metal, U_siding_wood, U_siding_metal, group_brick, group_siding]
 *
 * For 12A (no cavity insulation), brick and siding have different U-values.
 * For 12B-12F (with cavity insulation), brick and siding share U-values
 * (cavity dominates) but differ in Group letter (brick adds thermal mass).
 */
type FrameRow = [number, number, number, number, number, WallGroup, WallGroup];
function expandFrame(
  section: string,         // e.g. "12A", "12B"
  cavityLabel: string,     // e.g. "no cavity", "R-11 cavity"
  rows: FrameRow[],
  sourcePage: number,
): ConstructionVariant[] {
  const out: ConstructionVariant[] = [];
  for (const [boardR, uBw, uBm, uSw, uSm, gB, gS] of rows) {
    const boardLabel = boardR === 0 ? 'no board' : `R-${boardR} board`;
    const baseDesc = `Frame construction, ${cavityLabel}, ${boardLabel} insulation`;
    const stem = `${section}-${boardR}`;
    out.push(
      { id: `${stem}b/w`, description: `${baseDesc}, brick veneer, wood stud`, kind: 'frame_wall', referenceArea: 'net_wall_area', uValue: uBw, group: gB, sourcePage },
      { id: `${stem}b/m`, description: `${baseDesc}, brick veneer, metal stud`, kind: 'frame_wall', referenceArea: 'net_wall_area', uValue: uBm, group: gB, sourcePage },
      { id: `${stem}s/w`, description: `${baseDesc}, stucco/siding, wood stud`, kind: 'frame_wall', referenceArea: 'net_wall_area', uValue: uSw, group: gS, sourcePage },
      { id: `${stem}s/m`, description: `${baseDesc}, stucco/siding, metal stud`, kind: 'frame_wall', referenceArea: 'net_wall_area', uValue: uSm, group: gS, sourcePage },
    );
  }
  return out;
}

/**
 * Block-wall row that splits by core (open / filled) and finish (stucco/siding
 * vs brick veneer). Used for 13A (board only) and 13AB (no insulation, with finish).
 *
 * Tuple: [boardR, U_oc_stucco, U_fc_stucco, U_oc_brick, U_fc_brick, group]
 */
type BlockBoardRow = [number, number, number, number, number, WallGroup];
function expandBlockBoard(
  section: string,         // e.g. "13A"
  cavityLabel: string,     // e.g. "no cavity"
  rows: BlockBoardRow[],
  sourcePage: number,
): ConstructionVariant[] {
  const out: ConstructionVariant[] = [];
  for (const [boardR, uOcS, uFcS, uOcB, uFcB, g] of rows) {
    const boardLabel = boardR === 0 ? 'no board' : `R-${boardR} board`;
    const baseDesc = `Block, exterior finish, ${cavityLabel}, ${boardLabel}, plus interior finish`;
    const stem = `${section}-${boardR}`;
    out.push(
      { id: `${stem}oc s`, description: `${baseDesc}, stucco/siding, open core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uOcS, group: g, sourcePage },
      { id: `${stem}fc s`, description: `${baseDesc}, stucco/siding, filled core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uFcS, group: g, sourcePage },
      { id: `${stem}oc b`, description: `${baseDesc}, brick veneer, open core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uOcB, group: g, sourcePage },
      { id: `${stem}fc b`, description: `${baseDesc}, brick veneer, filled core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uFcB, group: g, sourcePage },
    );
  }
  return out;
}

/**
 * Block-wall row with framing (cavity insulation in stud) plus optional board.
 * Differs from `expandBlockBoard` because the framing variants don't split
 * on finish; instead they split on stud type (wood / metal).
 *
 * Tuple: [boardR, U_oc_wood, U_oc_metal, U_fc_wood, U_fc_metal, group]
 *
 * The Cobb Residence uses 13Ca-0oc-m (R-13 cavity, no board, open core, metal stud).
 */
type BlockFrameRow = [number, number, number, number, number, WallGroup];
function expandBlockFrame(
  section: string,         // e.g. "13B", "13Ca", "13CA"
  cavityLabel: string,     // e.g. "R-11 stud cavity"
  rows: BlockFrameRow[],
  sourcePage: number,
  noFinish = false,        // 13xA = no exterior finish; 13xB = with finish
): ConstructionVariant[] {
  const out: ConstructionVariant[] = [];
  for (const [boardR, uOcW, uOcM, uFcW, uFcM, g] of rows) {
    const boardLabel = boardR === 0 ? 'no board' : `R-${boardR} board`;
    const finishLabel = noFinish ? 'no exterior finish' : 'any exterior finish';
    const baseDesc = `Block, ${finishLabel}, ${cavityLabel}, ${boardLabel}, plus interior finish`;
    const stem = `${section}-${boardR}`;
    out.push(
      { id: `${stem}oc-w/m`.replace('w/m', 'w'), description: `${baseDesc}, wood stud, open core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uOcW, group: g, sourcePage },
      { id: `${stem}oc-m`,                       description: `${baseDesc}, metal stud, open core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uOcM, group: g, sourcePage },
      { id: `${stem}fc-w`,                       description: `${baseDesc}, wood stud, filled core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uFcW, group: g, sourcePage },
      { id: `${stem}fc-m`,                       description: `${baseDesc}, metal stud, filled core`, kind: 'block_wall', referenceArea: 'net_wall_area', uValue: uFcM, group: g, sourcePage },
    );
  }
  return out;
}

/**
 * Basement-wall variant (Construction 15). Each entry has a depth-dependent
 * below-grade U curve (5 points: 2/4/6/8/10 ft) plus a single above-grade U.
 *
 * Tuple: [id, [u2, u4, u6, u8, u10], aboveU, group]
 */
function basementWall(
  id: string,
  description: string,
  belowGrade: [number, number, number, number, number],
  aboveU: number,
  group: WallGroup,
  sourcePage: number,
): ConstructionVariant {
  return {
    id,
    description,
    kind: 'basement_wall',
    referenceArea: 'gross_wall_area',
    uValue: aboveU,
    group,
    belowGradeUByDepth: [
      { depthFt: 2, uValue: belowGrade[0] },
      { depthFt: 4, uValue: belowGrade[1] },
      { depthFt: 6, uValue: belowGrade[2] },
      { depthFt: 8, uValue: belowGrade[3] },
      { depthFt: 10, uValue: belowGrade[4] },
    ],
    sourcePage,
  };
}

// ============================================================================
// Construction 12 — Frame Walls (pp. 346-347)
// ============================================================================

const FRAME_WALLS: ConstructionVariant[] = [
  // 12A — No insulation in stud cavity (page 346)
  // [boardR, U_brick_wood, U_brick_metal, U_siding_wood, U_siding_metal, g_brick, g_siding]
  ...expandFrame('12A', 'no cavity insulation', [
    [0, 0.253, 0.315, 0.240, 0.295, 'E', 'A'],
    [2, 0.194, 0.230, 0.186, 0.219, 'E', 'A'],
    [3, 0.162, 0.187, 0.157, 0.180, 'F', 'B'],
    [4, 0.139, 0.157, 0.135, 0.152, 'F', 'B'],
    [5, 0.122, 0.136, 0.119, 0.132, 'G', 'C'],
    [6, 0.109, 0.120, 0.106, 0.117, 'G', 'C'],
  ], 346),

  // 12B — R-11 in 2x4 stud cavity (page 346)
  // (For 12B-12F, brick and siding share U; only Group letters differ.)
  ...expandFrame('12B', 'R-11 cavity insulation in 2x4', [
    [0, 0.097, 0.122, 0.097, 0.122, 'H', 'B'],
    [2, 0.086, 0.106, 0.086, 0.106, 'I', 'C'],
    [3, 0.079, 0.096, 0.079, 0.096, 'J', 'D'],
    [4, 0.073, 0.088, 0.073, 0.088, 'J', 'D'],
    [5, 0.068, 0.081, 0.068, 0.081, 'K', 'E'],
    [6, 0.064, 0.075, 0.064, 0.075, 'K', 'F'],
  ], 346),

  // 12C — R-13 in 2x4 stud cavity (page 346)
  ...expandFrame('12C', 'R-13 cavity insulation in 2x4', [
    [0, 0.091, 0.115, 0.091, 0.115, 'I', 'C'],
    [2, 0.081, 0.101, 0.081, 0.101, 'J', 'D'],
    [3, 0.075, 0.092, 0.075, 0.092, 'K', 'E'],
    [4, 0.069, 0.084, 0.069, 0.084, 'K', 'E'],
    [5, 0.064, 0.078, 0.064, 0.078, 'K', 'F'],
    [6, 0.060, 0.072, 0.060, 0.072, 'K', 'G'],
  ], 346),

  // 12D — R-15 in 2x4 stud cavity (page 347)
  ...expandFrame('12D', 'R-15 cavity insulation in 2x4', [
    [0, 0.086, 0.109, 0.086, 0.109, 'I', 'D'],
    [2, 0.077, 0.097, 0.077, 0.097, 'J', 'D'],
    [3, 0.071, 0.088, 0.071, 0.088, 'K', 'F'],
    [4, 0.066, 0.081, 0.066, 0.081, 'K', 'G'],
    [5, 0.062, 0.075, 0.062, 0.075, 'K', 'H'],
    [6, 0.058, 0.070, 0.058, 0.070, 'K', 'H'],
  ], 347),

  // 12E — R-19 in 2x6 stud cavity (page 347)
  ...expandFrame('12E', 'R-19 cavity insulation in 2x6', [
    [0, 0.068, 0.103, 0.068, 0.103, 'J', 'E'],
    [2, 0.063, 0.091, 0.063, 0.091, 'K', 'F'],
    [3, 0.059, 0.084, 0.059, 0.084, 'K', 'G'],
    [4, 0.055, 0.077, 0.055, 0.077, 'K', 'H'],
    [5, 0.052, 0.072, 0.052, 0.072, 'K', 'H'],
    [6, 0.049, 0.067, 0.049, 0.067, 'K', 'I'],
  ], 347),

  // 12F — R-21 in 2x6 stud cavity (page 347)
  ...expandFrame('12F', 'R-21 cavity insulation in 2x6', [
    [0, 0.065, 0.099, 0.065, 0.099, 'K', 'F'],
    [2, 0.060, 0.089, 0.060, 0.089, 'K', 'G'],
    [3, 0.058, 0.082, 0.058, 0.082, 'K', 'H'],
    [4, 0.053, 0.075, 0.053, 0.075, 'K', 'H'],
    [5, 0.050, 0.070, 0.050, 0.070, 'K', 'I'],
    [6, 0.048, 0.066, 0.048, 0.066, 'K', 'J'],
  ], 347),
];

// ============================================================================
// Construction 13 — Block Walls (pp. 348-351)
// ============================================================================

const BLOCK_WALLS: ConstructionVariant[] = [
  // 13AA — No blanket or board insulation, no exterior finish, no interior finish (page 348)
  { id: '13AA-0oc', description: 'Block, no exterior or interior finish, no surface insulation, open core', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.584, group: 'E', sourcePage: 348 },
  { id: '13AA-0fc', description: 'Block, no exterior or interior finish, no surface insulation, filled core', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.304, group: 'E', sourcePage: 348 },

  // 13AB — No insulation; stucco/siding or brick veneer; open or filled core; plus interior finish (page 348)
  { id: '13AB-0ocs', description: 'Block with exterior+interior finish, stucco/siding, open core, no surface insulation', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.258, group: 'E', sourcePage: 348 },
  { id: '13AB-0fcs', description: 'Block with exterior+interior finish, stucco/siding, filled core, no surface insulation', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.183, group: 'E', sourcePage: 348 },
  { id: '13AB-0ocb', description: 'Block with exterior+interior finish, brick veneer, open core, no surface insulation', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.272, group: 'E', sourcePage: 348 },
  { id: '13AB-0fcb', description: 'Block with exterior+interior finish, brick veneer, filled core, no surface insulation', kind: 'block_wall', referenceArea: 'net_wall_area', uValue: 0.191, group: 'E', sourcePage: 348 },

  // 13A — Board insulation only; stucco/siding or brick veneer; open or filled core; plus interior finish (page 348)
  // [boardR, U_oc_stucco, U_fc_stucco, U_oc_brick, U_fc_brick, group]
  ...expandBlockBoard('13A', 'no cavity', [
    [2,    0.201, 0.153, 0.210, 0.158, 'E'],
    [3,    0.167, 0.132, 0.174, 0.136, 'F'],
    [4,    0.143, 0.117, 0.148, 0.120, 'F'],
    [5,    0.125, 0.105, 0.129, 0.107, 'F'],
    [6,    0.111, 0.095, 0.114, 0.097, 'G'],
    [7.5,  0.095, 0.083, 0.097, 0.084, 'G'],
    [10,   0.077, 0.069, 0.078, 0.070, 'H'],
    [12.5, 0.065, 0.059, 0.066, 0.059, 'I'],
    [15,   0.056, 0.051, 0.056, 0.052, 'J'],
  ], 348),

  // 13BA — R-11 in 2x4 stud cavity, no board, no exterior finish (page 349)
  ...expandBlockFrame('13BA', 'R-11 stud cavity', [
    [0, 0.103, 0.131, 0.088, 0.108, 'H'],
  ], 349, true),

  // 13BB — R-11 in 2x4, no board, with exterior finish (page 349)
  ...expandBlockFrame('13BB', 'R-11 stud cavity', [
    [0, 0.088, 0.109, 0.077, 0.093, 'H'],
  ], 349),

  // 13B — R-11 in 2x4, plus board insulation, with exterior finish (page 349)
  ...expandBlockFrame('13B', 'R-11 stud cavity', [
    [2, 0.080, 0.097, 0.071, 0.084, 'I'],
    [3, 0.074, 0.089, 0.066, 0.078, 'I'],
    [4, 0.069, 0.082, 0.062, 0.072, 'I'],
    [5, 0.064, 0.075, 0.058, 0.067, 'J'],
  ], 349),

  // 13CA — R-13 in 2x4, no board, no exterior finish (page 349)
  ...expandBlockFrame('13Ca', 'R-13 stud cavity', [
    [0, 0.096, 0.123, 0.082, 0.103, 'I'],
  ], 349, true),

  // 13CB — R-13 in 2x4, no board, with exterior finish (page 349)
  ...expandBlockFrame('13CB', 'R-13 stud cavity', [
    [0, 0.083, 0.104, 0.073, 0.089, 'I'],
  ], 349),

  // 13C — R-13 in 2x4, plus board, with exterior finish (page 349)
  ...expandBlockFrame('13C', 'R-13 stud cavity', [
    [2, 0.075, 0.093, 0.067, 0.081, 'I'],
    [3, 0.070, 0.085, 0.063, 0.075, 'J'],
    [4, 0.065, 0.078, 0.059, 0.070, 'J'],
    [5, 0.061, 0.073, 0.055, 0.065, 'J'],
  ], 349),

  // 13DA — R-15 in 2x4, no board, no exterior finish (page 350)
  ...expandBlockFrame('13DA', 'R-15 stud cavity', [
    [0, 0.091, 0.116, 0.078, 0.098, 'I'],
  ], 350, true),

  // 13DB — R-15 in 2x4, no board, with exterior finish (page 350)
  ...expandBlockFrame('13DB', 'R-15 stud cavity', [
    [0, 0.079, 0.099, 0.069, 0.085, 'I'],
  ], 350),

  // 13D — R-15 in 2x4, plus board, with exterior finish (page 350)
  ...expandBlockFrame('13D', 'R-15 stud cavity', [
    [2, 0.072, 0.089, 0.064, 0.078, 'J'],
    [3, 0.067, 0.082, 0.060, 0.073, 'J'],
    [4, 0.062, 0.076, 0.056, 0.068, 'K'],
    [5, 0.058, 0.070, 0.053, 0.063, 'K'],
  ], 350),

  // 13EA — R-19 in 2x6, no board, no exterior finish (page 350)
  ...expandBlockFrame('13EA', 'R-19 stud cavity in 2x6', [
    [0, 0.071, 0.109, 0.063, 0.093, 'J'],
  ], 350, true),

  // 13EB — R-19 in 2x6, no board, with exterior finish (page 350)
  ...expandBlockFrame('13EB', 'R-19 stud cavity in 2x6', [
    [0, 0.064, 0.093, 0.057, 0.081, 'J'],
  ], 350),

  // 13E — R-19 in 2x6, plus board, with exterior finish (page 350)
  ...expandBlockFrame('13E', 'R-19 stud cavity in 2x6', [
    [2, 0.059, 0.085, 0.054, 0.075, 'K'],
    [3, 0.055, 0.078, 0.051, 0.070, 'K'],
    [4, 0.052, 0.073, 0.048, 0.065, 'K'],
    [5, 0.050, 0.068, 0.046, 0.061, 'K'],
  ], 350),

  // 13FA — R-21 in 2x6, no board, no exterior finish (page 351)
  ...expandBlockFrame('13FA', 'R-21 stud cavity in 2x6', [
    [0, 0.068, 0.105, 0.061, 0.090, 'K'],
  ], 351, true),

  // 13FB — R-21 in 2x6, no board, with exterior finish (page 351)
  ...expandBlockFrame('13FB', 'R-21 stud cavity in 2x6', [
    [0, 0.061, 0.091, 0.055, 0.079, 'K'],
  ], 351),

  // 13F — R-21 in 2x6, plus board, with exterior finish (page 351)
  ...expandBlockFrame('13F', 'R-21 stud cavity in 2x6', [
    [2, 0.057, 0.083, 0.052, 0.073, 'K'],
    [3, 0.054, 0.076, 0.049, 0.068, 'K'],
    [4, 0.051, 0.071, 0.047, 0.064, 'K'],
    [5, 0.048, 0.066, 0.044, 0.060, 'K'],
  ], 351),
];

// ============================================================================
// Construction 14 — Alternative Walls (page 352)
// ============================================================================

const ALT_WALLS: ConstructionVariant[] = [
  // 14A — Stacked Logs (Smith uses 14A-8 = 8" pine logs)
  { id: '14A-6',  description: 'Stacked logs, 6" thick, soft wood log, no insulation, no interior or exterior finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.119, group: 'G', sourcePage: 352 },
  { id: '14A-7',  description: 'Stacked logs, 7" thick',  kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.103, group: 'G', sourcePage: 352 },
  { id: '14A-8',  description: 'Stacked logs, 8" thick',  kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.091, group: 'H', sourcePage: 352 },
  { id: '14A-9',  description: 'Stacked logs, 9" thick',  kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.082, group: 'I', sourcePage: 352 },
  { id: '14A-10', description: 'Stacked logs, 10" thick', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.074, group: 'I', sourcePage: 352 },
  { id: '14A-11', description: 'Stacked logs, 11" thick', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.068, group: 'J', sourcePage: 352 },
  { id: '14A-12', description: 'Stacked logs, 12" thick', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.063, group: 'K', sourcePage: 352 },

  // 14B — Structural Foam Panel (SFP) with expanded polystyrene monolith (page 352)
  { id: '14B-4.5s', description: 'Structural foam panel 4.5" with expanded polystyrene monolith, stucco or wood siding', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.072, group: 'G', sourcePage: 352 },
  { id: '14B-6.5s', description: 'Structural foam panel 6.5" with expanded polystyrene monolith, stucco or wood siding', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.050, group: 'I', sourcePage: 352 },
  { id: '14B-4.5b', description: 'Structural foam panel 4.5", brick veneer, foam panel, interior finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.072, group: 'J', sourcePage: 352 },
  { id: '14B-6.5b', description: 'Structural foam panel 6.5", brick veneer, foam panel, interior finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.050, group: 'K', sourcePage: 352 },
  { id: '14B-4.5l', description: 'Structural foam panel 4.5", split log siding, foam panel, interior split-log finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.062, group: 'K', sourcePage: 352 },
  { id: '14B-6.5l', description: 'Structural foam panel 6.5", split logs on both sides', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.045, group: 'K', sourcePage: 352 },

  // 14C — Aerated Autoclaved Concrete (AAC) (Walker uses 14C-5 = R-5 board) (page 352)
  { id: '14C-0', description: 'AAC block, stucco/wood siding/brick veneer, no board insulation, plus interior finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.105, group: 'K', sourcePage: 352 },
  { id: '14C-2', description: 'AAC block, stucco/wood siding/brick veneer, R-2 foam board, plus interior finish',     kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.087, group: 'K', sourcePage: 352 },
  { id: '14C-3', description: 'AAC block, stucco/wood siding/brick veneer, R-3 foam board, plus interior finish',     kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.080, group: 'K', sourcePage: 352 },
  { id: '14C-4', description: 'AAC block, stucco/wood siding/brick veneer, R-4 foam board, plus interior finish',     kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.074, group: 'K', sourcePage: 352 },
  { id: '14C-5', description: 'AAC block, stucco/wood siding/brick veneer, R-5 foam board, plus interior finish',     kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.069, group: 'K', sourcePage: 352 },

  // 14D — Insulated Concrete Form (ICF) — foam matrix form filled with site-poured concrete (page 352)
  // ASTM-certified R-value ranges; engine looks up by closest range match.
  { id: '14D-13', description: 'ICF foam-concrete matrix, ASTM R-12 to R-14, exterior stucco/wood siding/brick veneer, plus interior finish', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.074, group: 'K', sourcePage: 352 },
  { id: '14D-15', description: 'ICF foam-concrete matrix, ASTM R-14 to R-16', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.066, group: 'K', sourcePage: 352 },
  { id: '14D-17', description: 'ICF foam-concrete matrix, ASTM R-16 to R-18', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.059, group: 'K', sourcePage: 352 },
  { id: '14D-19', description: 'ICF foam-concrete matrix, ASTM R-18 to R-20', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.054, group: 'K', sourcePage: 352 },
  { id: '14D-21', description: 'ICF foam-concrete matrix, ASTM R-20 to R-22', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.049, group: 'K', sourcePage: 352 },
  { id: '14D-24', description: 'ICF foam-concrete matrix, ASTM R-22 to R-26', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.044, group: 'K', sourcePage: 352 },
  { id: '14D-28', description: 'ICF foam-concrete matrix, ASTM R-26 to R-30', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.038, group: 'K', sourcePage: 352 },
  { id: '14D-33', description: 'ICF foam-concrete matrix, ASTM R-30 to R-36', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.034, group: 'K', sourcePage: 352 },

  // 14E — Two Courses Brick / Brick on Concrete / 8 Inches Concrete (page 352)
  // Use Construction 13 for walls with insulation that exceeds R-10.
  { id: '14E-0',  description: 'Two courses (8") brick, OR one course brick on 4" 140# concrete, OR 8" 140# concrete; no board insulation', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.388, group: 'G', sourcePage: 352 },
  { id: '14E-2',  description: 'Same as 14E-0 with R-2 foam board insulation', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.218, group: 'G', sourcePage: 352 },
  { id: '14E-3',  description: 'Same as 14E-0 with R-3 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.179, group: 'H', sourcePage: 352 },
  { id: '14E-4',  description: 'Same as 14E-0 with R-4 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.152, group: 'H', sourcePage: 352 },
  { id: '14E-5',  description: 'Same as 14E-0 with R-5 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.132, group: 'I', sourcePage: 352 },
  { id: '14E-6',  description: 'Same as 14E-0 with R-6 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.117, group: 'I', sourcePage: 352 },
  { id: '14E-10', description: 'Same as 14E-0 with R-10 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.079, group: 'J', sourcePage: 352 },

  // 14F — Four Inches of Concrete with stucco and interior finish (page 352)
  // Use Construction 13 for walls with insulation that exceeds R-10.
  { id: '14F-0',  description: '4" 140# concrete wall with stucco and interior finish, no board insulation', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.341, group: 'E', sourcePage: 352 },
  { id: '14F-2',  description: 'Same as 14F-0 with R-2 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.203, group: 'E', sourcePage: 352 },
  { id: '14F-3',  description: 'Same as 14F-0 with R-3 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.199, group: 'F', sourcePage: 352 },
  { id: '14F-4',  description: 'Same as 14F-0 with R-4 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.166, group: 'F', sourcePage: 352 },
  { id: '14F-5',  description: 'Same as 14F-0 with R-5 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.142, group: 'G', sourcePage: 352 },
  { id: '14F-6',  description: 'Same as 14F-0 with R-6 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.125, group: 'G', sourcePage: 352 },
  { id: '14F-10', description: 'Same as 14F-0 with R-10 foam board', kind: 'alternative_wall', referenceArea: 'net_wall_area', uValue: 0.083, group: 'H', sourcePage: 352 },
];

// ============================================================================
// Construction 15 — Basement Walls (pp. 353-354)
// ============================================================================
// Each variant has a depth-dependent below-grade U-value (5 points: 2/4/6/8/10
// ft of basement floor depth) plus a single above-grade U-value and Group.

const BASEMENT_WALLS: ConstructionVariant[] = [
  // 15A — Concrete Block Wall with Board Insulation (page 353)

  // No insulation, no framing, no interior finish
  basementWall('15A-0oc-x', 'Concrete block basement, no insulation, open core',
    [0.257, 0.185, 0.148, 0.125, 0.109], 0.584, 'E', 353),
  basementWall('15A-0fc-x', 'Concrete block basement, no insulation, filled core',
    [0.170, 0.132, 0.110, 0.095, 0.084], 0.304, 'E', 353),

  // R-2 closed cell foam board, 3 feet from sill plate
  basementWall('15A-2s3oc-x', 'R-2 closed cell foam board sill to 3 ft, open core',
    [0.157, 0.128, 0.110, 0.096, 0.086], 0.269, 'E', 353),
  basementWall('15A-2s3fc-x', 'R-2 closed cell foam board sill to 3 ft, filled core',
    [0.120, 0.102, 0.090, 0.080, 0.072], 0.188, 'E', 353),
  // R-2 sill plate to floor (full coverage)
  basementWall('15A-2sfoc-x', 'R-2 closed cell foam board sill to floor, open core',
    [0.157, 0.123, 0.103, 0.090, 0.080], 0.269, 'E', 353),
  basementWall('15A-2sffc-x', 'R-2 closed cell foam board sill to floor, filled core',
    [0.120, 0.098, 0.084, 0.075, 0.067], 0.188, 'E', 353),

  // R-4 board variants
  basementWall('15A-4s3oc-x', 'R-4 closed cell foam board sill to 3 ft, open core',
    [0.114, 0.102, 0.093, 0.083, 0.075], 0.175, 'F', 353),
  basementWall('15A-4s3fc-x', 'R-4 closed cell foam board sill to 3 ft, filled core',
    [0.094, 0.085, 0.078, 0.071, 0.065], 0.137, 'F', 353),
  basementWall('15A-4sfoc-x', 'R-4 closed cell foam board sill to floor, open core',
    [0.114, 0.094, 0.081, 0.072, 0.065], 0.175, 'F', 353),
  basementWall('15A-4sffc-x', 'R-4 closed cell foam board sill to floor, filled core (Smith Residence)',
    [0.094, 0.079, 0.069, 0.062, 0.057], 0.137, 'F', 353),

  // R-6 board variants
  basementWall('15A-6s3oc-x', 'R-6 closed cell foam board sill to 3 ft, open core',
    [0.089, 0.086, 0.082, 0.076, 0.069], 0.130, 'G', 353),
  basementWall('15A-6s3fc-x', 'R-6 closed cell foam board sill to 3 ft, filled core',
    [0.077, 0.074, 0.071, 0.066, 0.061], 0.107, 'G', 353),
  basementWall('15A-6sfoc-x', 'R-6 closed cell foam board sill to floor, open core',
    [0.089, 0.076, 0.067, 0.060, 0.055], 0.130, 'G', 353),
  basementWall('15A-6sffc-x', 'R-6 closed cell foam board sill to floor, filled core',
    [0.077, 0.066, 0.059, 0.054, 0.049], 0.107, 'G', 353),

  // R-8 board variants
  basementWall('15A-8s3oc-x', 'R-8 closed cell foam board sill to 3 ft, open core',
    [0.074, 0.076, 0.076, 0.070, 0.065], 0.103, 'G', 353),
  basementWall('15A-8s3fc-x', 'R-8 closed cell foam board sill to 3 ft, filled core',
    [0.065, 0.066, 0.066, 0.062, 0.058], 0.088, 'G', 353),
  basementWall('15A-8sfoc-x', 'R-8 closed cell foam board sill to floor, open core',
    [0.074, 0.064, 0.057, 0.052, 0.048], 0.103, 'G', 353),
  basementWall('15A-8sffc-x', 'R-8 closed cell foam board sill to floor, filled core',
    [0.065, 0.057, 0.052, 0.047, 0.044], 0.088, 'G', 353),

  // R-10 board variants
  basementWall('15A-10s3oc-x', 'R-10 closed cell foam board sill to 3 ft, open core',
    [0.063, 0.069, 0.071, 0.067, 0.062], 0.085, 'H', 353),
  basementWall('15A-10s3fc-x', 'R-10 closed cell foam board sill to 3 ft, filled core',
    [0.056, 0.061, 0.062, 0.059, 0.055], 0.075, 'H', 353),
  basementWall('15A-10sfoc-x', 'R-10 closed cell foam board sill to floor, open core',
    [0.063, 0.056, 0.050, 0.046, 0.043], 0.085, 'H', 353),
  basementWall('15A-10sffc-x', 'R-10 closed cell foam board sill to floor, filled core',
    [0.056, 0.050, 0.046, 0.042, 0.039], 0.075, 'H', 353),

  // R-15 board variants
  basementWall('15A-15s3oc-x', 'R-15 closed cell foam board sill to 3 ft, open core',
    [0.064, 0.057, 0.063, 0.061, 0.058], 0.060, 'J', 353),
  basementWall('15A-15s3fc-x', 'R-15 closed cell foam board sill to 3 ft, filled core',
    [0.042, 0.051, 0.056, 0.054, 0.052], 0.055, 'J', 353),
  basementWall('15A-15sfoc-x', 'R-15 closed cell foam board sill to floor, open core',
    [0.046, 0.042, 0.039, 0.036, 0.034], 0.060, 'J', 353),
  basementWall('15A-15sffc-x', 'R-15 closed cell foam board sill to floor, filled core',
    [0.042, 0.039, 0.036, 0.034, 0.032], 0.055, 'J', 353),

  // R-20 board variants
  basementWall('15A-20s3oc-x', 'R-20 closed cell foam board sill to 3 ft, open core',
    [0.036, 0.051, 0.059, 0.058, 0.055], 0.046, 'K', 353),
  basementWall('15A-20s3fc-x', 'R-20 closed cell foam board sill to 3 ft, filled core',
    [0.034, 0.045, 0.052, 0.051, 0.049], 0.043, 'K', 353),
  basementWall('15A-20sfoc-x', 'R-20 closed cell foam board sill to floor, open core',
    [0.036, 0.033, 0.031, 0.029, 0.028], 0.046, 'K', 353),
  basementWall('15A-20sffc-x', 'R-20 closed cell foam board sill to floor, filled core',
    [0.034, 0.031, 0.030, 0.028, 0.026], 0.043, 'K', 353),

  // 15A framing variants — concrete block + cavity insulation in stud (page 354)
  basementWall('15A11-0ocw-x', 'Block + R-11 cavity in 2x4 wood stud, sill to floor, open core',
    [0.074, 0.064, 0.057, 0.052, 0.048], 0.103, 'H', 354),
  basementWall('15A11-0fcw-x', 'Block + R-11 cavity in 2x4 wood stud, sill to floor, filled core',
    [0.065, 0.057, 0.052, 0.047, 0.044], 0.088, 'H', 354),
  basementWall('15A11-0ocm-x', 'Block + R-11 cavity in 2x4 metal stud, sill to floor, open core',
    [0.090, 0.077, 0.067, 0.061, 0.055], 0.131, 'H', 354),
  basementWall('15A11-0fcm-x', 'Block + R-11 cavity in 2x4 metal stud, sill to floor, filled core',
    [0.077, 0.067, 0.059, 0.054, 0.049], 0.108, 'H', 354),

  basementWall('15A13-0ocw-x', 'Block + R-13 cavity in 2x4 wood stud, sill to floor, open core',
    [0.070, 0.061, 0.055, 0.050, 0.046], 0.096, 'I', 354),
  basementWall('15A13-0fcw-x', 'Block + R-13 cavity in 2x4 wood stud, sill to floor, filled core',
    [0.061, 0.054, 0.049, 0.045, 0.042], 0.082, 'I', 354),
  basementWall('15A13-0ocm-x', 'Block + R-13 cavity in 2x4 metal stud, sill to floor, open core',
    [0.086, 0.073, 0.065, 0.058, 0.053], 0.123, 'I', 354),
  basementWall('15A13-0fcm-x', 'Block + R-13 cavity in 2x4 metal stud, sill to floor, filled core',
    [0.074, 0.064, 0.057, 0.052, 0.048], 0.103, 'I', 354),

  basementWall('15A15-0ocw-x', 'Block + R-15 cavity in 2x4 wood stud, sill to floor, open core',
    [0.066, 0.058, 0.053, 0.048, 0.044], 0.091, 'I', 354),
  basementWall('15A15-0fcw-x', 'Block + R-15 cavity in 2x4 wood stud, sill to floor, filled core',
    [0.058, 0.052, 0.047, 0.043, 0.040], 0.078, 'I', 354),
  basementWall('15A15-0ocm-x', 'Block + R-15 cavity in 2x4 metal stud, sill to floor, open core',
    [0.082, 0.070, 0.062, 0.056, 0.051], 0.118, 'I', 354),
  basementWall('15A15-0fcm-x', 'Block + R-15 cavity in 2x4 metal stud, sill to floor, filled core',
    [0.071, 0.062, 0.055, 0.050, 0.046], 0.098, 'I', 354),

  basementWall('15A19-0ocw-x', 'Block + R-19 cavity in 2x6 wood stud, sill to floor, open core',
    [0.053, 0.048, 0.044, 0.041, 0.038], 0.071, 'J', 354),
  basementWall('15A19-0fcw-x', 'Block + R-19 cavity in 2x6 wood stud, sill to floor, filled core',
    [0.048, 0.044, 0.040, 0.037, 0.035], 0.063, 'J', 354),
  basementWall('15A19-0ocm-x', 'Block + R-19 cavity in 2x6 metal stud, sill to floor, open core',
    [0.077, 0.067, 0.060, 0.054, 0.050], 0.109, 'J', 354),
  basementWall('15A19-0fcm-x', 'Block + R-19 cavity in 2x6 metal stud, sill to floor, filled core',
    [0.068, 0.059, 0.053, 0.049, 0.045], 0.093, 'J', 354),

  basementWall('15A21-0ocw-x', 'Block + R-21 cavity in 2x6 wood stud, sill to floor, open core',
    [0.051, 0.046, 0.042, 0.039, 0.037], 0.068, 'K', 354),
  basementWall('15A21-0fcw-x', 'Block + R-21 cavity in 2x6 wood stud, sill to floor, filled core',
    [0.047, 0.042, 0.039, 0.036, 0.034], 0.061, 'K', 354),
  basementWall('15A21-0ocm-x', 'Block + R-21 cavity in 2x6 metal stud, sill to floor, open core',
    [0.075, 0.065, 0.058, 0.053, 0.048], 0.105, 'K', 354),
  basementWall('15A21-0fcm-x', 'Block + R-21 cavity in 2x6 metal stud, sill to floor, filled core',
    [0.066, 0.058, 0.052, 0.048, 0.044], 0.090, 'K', 354),
];

// ============================================================================
// Construction 16 / 17 / 18 — Ceilings
// ============================================================================
// Ceilings use a direct CLTD (no Group letter) per Worksheet D.
//
// ┌─ CEILING CLTD PROVENANCE (Table 4A family rows) ────────────────────────┐
// │ SOURCE CORRECTION (2026-07-15): ceiling CLTDs are published directly in │
// │ **Table 4A** (pp. 362-364 in v2.50) as one CLTD-by-(CTD, DR) row per    │
// │ ceiling FAMILY (16A/16B/16C/16D/16E/16F, keyed by attic temperature),   │
// │ shared by every R-value variant in that family. They are NOT in "Table  │
// │ 4D" (that's sunroom ambient temps) — the old TABLE-4D-GAP note here     │
// │ inferred that citation without the book.                                 │
// │                                                                          │
// │ The matrices below were transcribed 2026-07-15 by Claude from Nathan    │
// │ Griffith's photographs of the physical ACCA Manual J 8th Ed v2.50:      │
// │   · 16B family row — p. 362 (attic temp 130°F @ 95°F outdoor)           │
// │   · 16C family row — p. 363 (attic temp 120°F)                          │
// │   · 16D family row — p. 363 (attic temp 110°F; covers 16DR/16DF)        │
// │ Triple verification: (1) every previously-encoded cert anchor matches   │
// │ its family row exactly (16B 15/M=50 Smith; 16C 15/L=44 and 16D 15/L=34  │
// │ Walker §13); (2) rows carry the book's arithmetic structure (+5 per CTD │
// │ bin step, −10 per attic-temp tier); (3) the sparse (CTD, DR) layout     │
// │ matches Table 4B's exactly. Golden tests: __tests__/ceilingCltd.test.ts │
// │                                                                          │
// │ COMPLETE (2026-07-15, second photo batch): the 16F family row (p. 364,  │
// │ attic temp 95°F — vented, no RB, white tile/metal/membrane) is encoded  │
// │ below; its 15/L=19 cell matched the Walker cert anchor exactly. The     │
// │ 16A and 16E rows are transcribed in docs/table4d-transcription-         │
// │ worksheet.md but NOT encoded (no registry variant uses them yet — they  │
// │ must be re-verified against the p.362/364 photos before ever encoding). │
// │ Family rows verify against the book's linear structure: the 10/L cell   │
// │ equals attic_temp − 81 for every family (150→69, 130→49, 120→39,        │
// │ 110→29, 105→24, 95→14).                                                  │
// │ Transcription rules unchanged: values come from the book only — NO      │
// │ interpolation, no extrapolation from Table 4B, no legacy-formula        │
// │ derivation. The round-up lookup in lookup.ts covers new bins the        │
// │ moment they are populated.                                               │
// └──────────────────────────────────────────────────────────────────────────┘

// 16B family CLTD row — Table 4A p. 362 (FHA vented attic, no radiant
// barrier; dark asphalt shingles / dark metal / tar+gravel / membrane;
// attic temp 130°F @ 95°F outdoor). Anchor cross-check: 15/M = 50 =
// Smith line 10-a.
const CLTD_16B: Partial<Record<CTDBin, CLTDCell>> = {
  10: { L: 49, M: 45 },
  15: { L: 54, M: 50, H: 45 },
  20: { L: 59, M: 55, H: 50 },
  25: { M: 60, H: 55 },
  30: { H: 60 },
  35: { H: 65 },
};

// 16C family CLTD row — Table 4A p. 363 (FHA vented attic, no radiant
// barrier; white/light shingles, any wood shake, light metal, tar+gravel
// or membrane; attic temp 120°F). Anchor cross-check: 15/L = 44 =
// Walker §13 option 16C-38aw.
const CLTD_16C: Partial<Record<CTDBin, CLTDCell>> = {
  10: { L: 39, M: 35 },
  15: { L: 44, M: 40, H: 35 },
  20: { L: 49, M: 45, H: 40 },
  25: { M: 50, H: 45 },
  30: { H: 50 },
  35: { H: 55 },
};

// 16D family CLTD row — Table 4A p. 363 (attic temp 110°F; 16D = vented,
// no RB, dark tile/slate/concrete; 16DR = vented WITH radiant barrier,
// white/light shingles etc.; 16DF = light roof + attic fan). Anchor
// cross-check: 15/L = 34 = Walker §13 option 16DR-38aw.
const CLTD_16D: Partial<Record<CTDBin, CLTDCell>> = {
  10: { L: 29, M: 25 },
  15: { L: 34, M: 30, H: 25 },
  20: { L: 39, M: 35, H: 30 },
  25: { M: 40, H: 35 },
  30: { H: 40 },
  35: { H: 45 },
};

// 16F family CLTD row — Table 4A p. 364 (attic temp 95°F @ 95°F outdoor;
// 16F = vented attic, no RB, white tile/slate/concrete, white metal or
// white membrane; 16FR = vented WITH radiant barrier, light/white tile
// etc.). Anchor cross-check: 15/L = 19 = Walker Form J1 line 10-a
// (selected ceiling 16F-38tw, Florida).
const CLTD_16F: Partial<Record<CTDBin, CLTDCell>> = {
  10: { L: 14, M: 10 },
  15: { L: 19, M: 15, H: 10 },
  20: { L: 24, M: 20, H: 15 },
  25: { M: 25, H: 20 },
  30: { H: 25 },
  35: { H: 30 },
};

const CEILINGS: ConstructionVariant[] = [
  // Smith — R-30, attic, dark shingle roof
  {
    id: '16B-30ad',
    description: 'Ceiling under attic, R-30 insulation, dark shingle roof, no radiant barrier',
    kind: 'ceiling',
    referenceArea: 'net_ceiling_area',
    uValue: 0.032, // Table 4A p.362: 16B-30, R-30 → U 0.032 (verified vs source)
    // Full 16B family row (Table 4A p.362) — anchor 15/M = 50 also cited by
    // Smith Form J1 line 10-a (HTM_c 1.60 = U 0.032 × CLTD 50, Iowa).
    directCLTD: CLTD_16B,
  },
  // Walker — R-38, white tile roof, no RB
  {
    id: '16F-38tw',
    description: 'Ceiling under attic, R-38 insulation, white tile roof, no radiant barrier',
    kind: 'ceiling',
    referenceArea: 'net_ceiling_area',
    uValue: 0.026,
    // Full 16F family row (Table 4A p.364) — anchor 15/L = 19 also cited by
    // Walker Form J1 line 10-a (the selected Walker ceiling).
    directCLTD: CLTD_16F,
  },
  // Walker comparison options (not selected)
  {
    id: '16DR-38aw',
    description: 'Ceiling under attic, R-38 insulation, white shingle roof, with radiant barrier',
    kind: 'ceiling',
    referenceArea: 'net_ceiling_area',
    uValue: 0.026,
    // Full 16D family row (Table 4A p.363; 16DR = vented attic WITH radiant
    // barrier, white/light shingles) — anchor 15/L = 34 also cited by
    // Walker §13 ceiling comparison options.
    directCLTD: CLTD_16D,
  },
  {
    id: '16C-38aw',
    description: 'Ceiling under attic, R-38 insulation, white shingle roof, no radiant barrier',
    kind: 'ceiling',
    referenceArea: 'net_ceiling_area',
    uValue: 0.026,
    // Full 16C family row (Table 4A p.363) — anchor 15/L = 44 also cited by
    // Walker §13 ceiling comparison options.
    directCLTD: CLTD_16C,
  },
];

// ============================================================================
// Construction 19 / 20 / 21 — Floors
// ============================================================================

// ┌─ CONSTRUCTION 19 FLOOR PTD PROVENANCE (Table 4A pp. 371-377) ───────────┐
// │ The book publishes floor PTDH as a row per variant over HTD columns     │
// │ 20..95 (5°F steps) and PTDC over CTD 10..35 (CTD-only — the printed     │
// │ cells span the daily-range sub-columns). Rows below are the SEALED,     │
// │ PASSIVE block of family 19B (R-4 insulation on exposed walls,           │
// │ U_wall = 0.143) — transcribed 2026-07-15 by Claude from Nathan          │
// │ Griffith's close-up photograph of the 19B(s) page.                      │
// │                                                                          │
// │ Verification: (1) the pre-existing Smith cert anchor maps EXACTLY —     │
// │ 19B-0sp @ HTD 75 → 6.6 and @ CTD 15 → 1.3, the values validated by     │
// │ Smith Form J1 (Des Moines: HTD 75 / CTD 15); (2) every row is linear    │
// │ through the origin (PTD = k × TD, same k both sides), the book's        │
// │ printed structure; (3) HTM = U × PTD decreases monotonically with       │
// │ floor R as expected. One edge cell (19B-2sp @ HTD 85 = 12.5) was        │
// │ page-curl-partial in the photo and is structure-confirmed — flagged     │
// │ in docs/table4d-transcription-worksheet.md for an eyeball re-check.     │
// │                                                                          │
// │ NOT encoded (photos archived, legible): 19A (no wall insulation),       │
// │ 19B vented, 19C sealed/vented (R-11 walls), radiant blocks; 19D         │
// │ (R-19 walls) exists only as full-page shots. The legacy adapter can     │
// │ only select the sealed/passive R-4-wall tier today, so only that        │
// │ block ships. Lookup: lookupFloorPTD — LINEAR INTERPOLATION between      │
// │ columns per the ACCA 5% rule (rows are linear; round-up would break     │
// │ the 5% threshold at low PTD magnitudes).                                 │
// └──────────────────────────────────────────────────────────────────────────┘

const HTD_COLS: HTDColumn[] = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
const CTD_COLS: CTDBin[] = [10, 15, 20, 25, 30, 35];

/** Zip a printed PTD row (in column order) into the typed record. A short
 *  or long array would silently shift the lookup envelope, so the length
 *  is asserted — a transcription must supply every printed column. */
function ptdhRow(values: number[]): Partial<Record<HTDColumn, number>> {
  if (values.length !== HTD_COLS.length) {
    throw new Error(`ptdhRow: expected ${HTD_COLS.length} PTDH cells, got ${values.length}`);
  }
  const out: Partial<Record<HTDColumn, number>> = {};
  HTD_COLS.forEach((c, i) => { out[c] = values[i]; });
  return out;
}
function ptdcRow(values: number[]): Partial<Record<CTDBin, number>> {
  if (values.length !== CTD_COLS.length) {
    throw new Error(`ptdcRow: expected ${CTD_COLS.length} PTDC cells, got ${values.length}`);
  }
  const out: Partial<Record<CTDBin, number>> = {};
  CTD_COLS.forEach((c, i) => { out[c] = values[i]; });
  return out;
}

/** One sealed/passive 19B floor variant straight off the printed row. */
function floor19B(
  id: string, description: string, uValue: number,
  ptdh16: number[], ptdc6: number[],
): ConstructionVariant {
  return {
    id, description, kind: 'floor', referenceArea: 'gross_floor_area',
    uValue,
    ptdhByHtd: ptdhRow(ptdh16),
    ptdcByCtd: ptdcRow(ptdc6),
  };
}

const FLOORS: ConstructionVariant[] = [
  {
    id: '19B-osp', // book row 19B-0sp — id kept for registry compat
    description: 'Floor over sealed crawl space (R-4 exposed walls), no floor insulation',
    kind: 'floor',
    referenceArea: 'gross_floor_area',
    uValue: 0.368,
    // Reference-point values kept for provenance/fallback (Smith: HTD 75 /
    // CTD 15). The full rows below supersede them at runtime.
    ptdh: 6.6,
    ptdc: 1.3,
    ptdhByHtd: ptdhRow([1.8, 2.2, 2.7, 3.1, 3.5, 4.0, 4.4, 4.9, 5.3, 5.8, 6.2, 6.6, 7.1, 7.5, 8.0, 8.4]),
    ptdcByCtd: ptdcRow([0.9, 1.3, 1.8, 2.2, 2.7, 3.1]),
  },
  floor19B('19B-2sp', 'Floor over sealed crawl space (R-4 exposed walls), R-2 to R-4 board', 0.206,
    [3.0, 3.7, 4.4, 5.2, 5.9, 6.6, 7.4, 8.1, 8.9, 9.6, 10.3, 11.1, 11.8, 12.5, 13.3, 14.0],
    [1.5, 2.2, 3.0, 3.7, 4.4, 5.2]),
  floor19B('19B-5sp', 'Floor over sealed crawl space (R-4 exposed walls), R-5 to R-10 board', 0.125,
    [4.4, 5.6, 6.7, 7.8, 8.9, 10.0, 11.1, 12.2, 13.3, 14.4, 15.6, 16.7, 17.8, 18.9, 20.0, 21.1],
    [2.2, 3.3, 4.4, 5.6, 6.7, 7.8]),
  floor19B('19B-11sp', 'Floor over sealed crawl space (R-4 exposed walls), R-11 or R-15 blanket', 0.073,
    [6.6, 8.2, 9.8, 11.5, 13.1, 14.7, 16.4, 18.0, 19.7, 21.3, 22.9, 24.6, 26.2, 27.8, 29.5, 31.1],
    [3.3, 4.9, 6.6, 8.2, 9.8, 11.5]),
  floor19B('19B-19sp', 'Floor over sealed crawl space (R-4 exposed walls), R-19 or R-21 blanket', 0.049,
    [8.5, 10.6, 12.7, 14.8, 17.0, 19.1, 21.2, 23.3, 25.4, 27.6, 29.7, 31.8, 33.9, 36.0, 38.2, 40.3],
    [4.2, 6.4, 8.5, 10.6, 12.7, 14.8]),
  floor19B('19B-30sp', 'Floor over sealed crawl space (R-4 exposed walls), R-30 blanket', 0.034,
    [10.2, 12.7, 15.3, 17.8, 20.4, 22.9, 25.5, 28.0, 30.6, 33.1, 35.7, 38.2, 40.8, 43.3, 45.9, 48.4],
    [5.1, 7.6, 10.2, 12.7, 15.3, 17.8]),
  floor19B('19B-38sp', 'Floor over sealed crawl space (R-4 exposed walls), R-38 blanket', 0.029,
    [11.1, 13.8, 16.6, 19.4, 22.1, 24.9, 27.6, 30.4, 33.2, 35.9, 38.7, 41.5, 44.2, 47.0, 49.8, 52.5],
    [5.5, 8.3, 11.1, 13.8, 16.6, 19.4]),
  {
    id: '21A-32',
    description: 'Floor exposed (heat-only basement floor)',
    kind: 'floor',
    referenceArea: 'gross_floor_area',
    uValue: 0.020,
  },
];

// ============================================================================
// Construction 22 — Slab Floors (use F-value × HTD × exposed-edge feet)
// ============================================================================

const SLABS: ConstructionVariant[] = [
  {
    id: '22B-5ph',
    description: 'Concrete slab, R-5 vertical edge insulation 3 ft, heavy moist soil',
    kind: 'slab',
    referenceArea: 'feet_of_exposed_edge',
    uValue: 0,
    fValue: 0.589,
  },
  {
    id: '22D-5rl',
    description: 'Radiant slab, R-5 insulation 4 ft back, dry sandy soil',
    kind: 'slab',
    referenceArea: 'feet_of_exposed_edge',
    uValue: 0,
    fValue: 0.287,
    radiant: true,
  },
];

// ============================================================================
// Construction 1-10 — Generic fenestration (Cobb uses 1D, 1E)
// ============================================================================

const GENERIC_FENESTRATION: ConstructionVariant[] = [
  {
    id: '1D',
    description: 'Generic glass, double pane clear, metal frame (no thermal break)',
    kind: 'fenestration_generic',
    referenceArea: 'rough_opening',
    uValue: 0.87,
  },
  {
    id: '1E',
    description: 'Generic glass, double pane clear, metal frame (no break), fixed window',
    kind: 'fenestration_generic',
    referenceArea: 'rough_opening',
    uValue: 0.69,
  },
];

// ============================================================================
// Combined registry
// ============================================================================

const ALL_VARIANTS: ConstructionVariant[] = [
  ...DOORS,
  ...FRAME_WALLS,
  ...BLOCK_WALLS,
  ...ALT_WALLS,
  ...BASEMENT_WALLS,
  ...CEILINGS,
  ...FLOORS,
  ...SLABS,
  ...GENERIC_FENESTRATION,
];

const REGISTRY = new Map<string, ConstructionVariant>(
  ALL_VARIANTS.map((v) => [v.id, v]),
);

/** Look up a Construction by its code (e.g. "14A-8", "11N", "13Ca-0oc-m"). */
export function getConstruction(id: string): ConstructionVariant | undefined {
  return REGISTRY.get(id);
}

/** All registered construction variants (read-only). */
export function listConstructions(): ConstructionVariant[] {
  return [...ALL_VARIANTS];
}

/** Number of registered variants — useful for docs and sanity checks. */
export const REGISTRY_SIZE = ALL_VARIANTS.length;

/** Find the below-grade U-value for a basement wall at a specific floor depth.
 *  Linear interpolation between captured depths. */
export function basementWallUAtDepth(
  variant: ConstructionVariant,
  depthFt: number,
): number {
  if (!variant.belowGradeUByDepth) return variant.uValue;
  const points = variant.belowGradeUByDepth;
  // Exact match
  const exact = points.find((p) => p.depthFt === depthFt);
  if (exact) return exact.uValue;
  // Below first point
  if (depthFt <= points[0].depthFt) return points[0].uValue;
  // Above last point
  if (depthFt >= points[points.length - 1].depthFt) {
    return points[points.length - 1].uValue;
  }
  // Interpolate
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (depthFt >= a.depthFt && depthFt <= b.depthFt) {
      const frac = (depthFt - a.depthFt) / (b.depthFt - a.depthFt);
      return a.uValue + frac * (b.uValue - a.uValue);
    }
  }
  return variant.uValue;
}
