/**
 * Manual J 8th Edition v2.50 — Engine Type System
 * =================================================
 * Cert-grade types backing the Form J1 calculation pipeline.
 *
 * This module is independent of the legacy `engines/manualJ.ts`. The two
 * engines coexist; UIs opt into the cert-grade engine via this module's
 * public API in `index.ts`.
 *
 * Validated against three ACCA reference test cases:
 *   - Smith Residence  (§12, Iowa, log walls, basement)        70/70 ✓
 *   - Walker Residence (§13, Florida, AAC walls, radiant slab) 72/72 ✓
 *   - Cobb Residence   (§14, Florida, AED excursion case)      42/42 ✓
 * Combined: 184/184 line-item checks within 0.5% cert tolerance.
 * Total drift on every published total: < 0.02% (two orders of magnitude
 * below ACCA tolerance).
 */

// ============================================================================
// Climate / design conditions
// ============================================================================

/** Daily Range classification per Manual J Table 1.
 *  L (Low)   — DR ≤ 16°F (humid coastal)
 *  M (Medium) — 16 < DR ≤ 25°F (typical inland)
 *  H (High)  — DR > 25°F (high-desert / arid mountain) */
export type DailyRange = 'L' | 'M' | 'H';

/** Design conditions for a single project location. */
export interface DesignConditions {
  state: string;
  city: string;
  elevation: number;            // ft above sea level
  latitude: number;             // degrees N
  /** Indoor heating dry-bulb (default 70°F per Manual J). */
  indoorHeatDB: number;
  /** Indoor cooling dry-bulb (default 75°F per Manual J). */
  indoorCoolDB: number;
  /** Indoor cooling RH (default 50% per Manual J). */
  indoorCoolRH: number;
  /** 99% winter design dry-bulb from Table 1. */
  outdoor99DB: number;
  /** 1% summer design dry-bulb from Table 1. */
  outdoor1DB: number;
  /** Coincident wet-bulb at outdoor1DB. */
  coincidentWB: number;
  /** Δ Grains (outdoor − indoor humidity ratio difference, gr/lb). */
  deltaGrains: number;
  dailyRange: DailyRange;
  /** Heating Temperature Difference: indoorHeatDB − outdoor99DB. */
  HTD: number;
  /** Cooling Temperature Difference: outdoor1DB − indoorCoolDB. */
  CTD: number;
  /** Altitude correction factor from Table 10A (1.00 at sea level). */
  ACF: number;
}

// ============================================================================
// Table 4B — CLTD Lookup
// ============================================================================

/** Group letters in Table 4B, ordered from lightest mass (A) to heaviest (K).
 *  Lower mass → higher CLTD peak (faster thermal response).
 *  Heavier mass → lower CLTD peak (dampened thermal response, longer lag). */
export type WallGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

/** Design CTD bins in Table 4B. Most CTDs round UP to the next bin per
 *  Manual J design conservatism (NOT linear interpolation). */
export type CTDBin = 10 | 15 | 20 | 25 | 30 | 35;

/** HTD columns printed in the Construction 19 floor PTD tables (Table 4A
 *  pp. 371-377). Unlike the CLTD round-up convention, floor PTD lookups
 *  INTERPOLATE between columns — the printed rows are linear in TD, and
 *  rounding a 5°F step at low PTD magnitudes exceeds the ACCA 5% rule. */
export type HTDColumn =
  | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55
  | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95;

/** Table 4B is sparse — not every (CTD, DR) cell is populated. Cells where
 *  the climate combination is unrealistic are omitted (e.g. CTD=10 with H,
 *  CTD=35 with L). The lookup function handles missing cells gracefully. */
export type CLTDCell = Partial<Record<DailyRange, number>>;

export interface WallGroupCells {
  /** Above-grade wall CLTD (uses solar gain). */
  wall: Partial<Record<CTDBin, CLTDCell>>;
  /** Partition wall CLTD (no solar — typically ~10°F lower than wall). */
  partition: Partial<Record<CTDBin, CLTDCell>>;
}

export type Table4BData = Record<WallGroup, WallGroupCells>;

// ============================================================================
// Construction registry (Manual J Table 4A)
// ============================================================================

/** Categories of building elements in Manual J. */
export type ConstructionKind =
  | 'door'              // Construction 11 — direct CLTD, no Group
  | 'frame_wall'        // Construction 12 — Group lookup
  | 'block_wall'        // Construction 13 — Group lookup
  | 'alternative_wall'  // Construction 14 — Group lookup
  | 'basement_wall'     // Construction 15 — depth-dependent below-grade U
  | 'ceiling'           // Construction 16/17/18 — direct CLTD or Group
  | 'floor'             // Construction 19/20/21 — PTDH/PTDC for partitions
  | 'slab'              // Construction 22 — F-value × HTD × edge feet
  | 'fenestration_generic'; // Construction 1-10 — Table 2A U/SHGC

/** Reference area model for the construction. Used by the consumer to know
 *  which area input applies (gross/net/perimeter). */
export type ReferenceArea =
  | 'rough_opening'       // windows, doors, glass
  | 'net_wall_area'       // gross wall − openings
  | 'gross_wall_area'     // basement walls
  | 'net_ceiling_area'    // gross ceiling − openings
  | 'gross_floor_area'    // floors over enclosed/open space
  | 'feet_of_exposed_edge'; // slab perimeter

/** A single entry in the Construction registry. */
export interface ConstructionVariant {
  /** Construction code, e.g. "14A-8", "13Ca-0oc-m", "11N". */
  id: string;
  /** Human-readable description. */
  description: string;
  kind: ConstructionKind;
  referenceArea: ReferenceArea;
  /** U-value for heating (Btu/hr·ft²·°F). */
  uValue: number;
  /** Group letter for Table 4B lookup (cooling). Absent for doors and
   *  ceilings that use a direct CLTD. */
  group?: WallGroup;
  /** Direct CLTD by (CTDBin, DailyRange) for elements that bypass Table 4B
   *  (doors and some ceilings). */
  directCLTD?: Partial<Record<CTDBin, CLTDCell>>;
  /** F-value for slabs (Btu/hr·ft·°F). */
  fValue?: number;
  /** Below-grade U-value by basement floor depth (ft) for Construction 15. */
  belowGradeUByDepth?: { depthFt: number; uValue: number }[];
  /** Partition temperature difference for heating. Used when this
   *  construction sits between conditioned space and a buffer space.
   *  For Construction 19 floors this is a single REFERENCE-POINT value
   *  (kept for provenance/fallback) — prefer `ptdhByHtd`, the full
   *  climate-dependent row from Table 4A pp. 371-377. */
  ptdh?: number;
  /** Partition temperature difference for cooling. Reference point;
   *  prefer `ptdcByCtd` where present. */
  ptdc?: number;
  /** Construction 19 floor PTDH row — PTDH by heating design temperature
   *  difference (Table 4A pp. 371-377, columns HTD 20..95 in 5°F steps).
   *  Looked up via lookupFloorPTD with LINEAR INTERPOLATION between
   *  columns (ACCA 5% interpolation rule — the printed rows are linear). */
  ptdhByHtd?: Partial<Record<HTDColumn, number>>;
  /** Construction 19 floor PTDC row — PTDC by cooling design temperature
   *  difference. NOTE: the book publishes PTDC as a function of CTD ONLY
   *  (the printed cells span all daily-range sub-columns). */
  ptdcByCtd?: Partial<Record<CTDBin, number>>;
  /** Used for radiant floors/slabs: HTM = F × (HTD + 25). */
  radiant?: boolean;
  /** Source page in Manual J 8th Ed v2.50 for traceability. */
  sourcePage?: number;
}

// ============================================================================
// Page-384 adjustments (Table 4B notes)
// ============================================================================

/** Manual J wall color — multiplies the Figure A12-8 base CLTD. */
export type WallColor = 'medium' | 'dark' | 'light';

/** Page-384 adjustment context — used by `applyAdjustments()`. */
export interface AdjustmentContext {
  color: WallColor;
  /** Outdoor design temp (used in "if T_design > 95°F" rule). */
  outdoorDesignDB: number;
  dailyRange: DailyRange;
  /** True for externally shaded walls — uses North CLTD per page-384 note 1. */
  externallyShaded: boolean;
}

// ============================================================================
// Worksheet B — Window HTM
// ============================================================================

/** A single fenestration unit on Form J1 line 6a (one direction × one size). */
export interface WindowInput {
  /** Form J1 row id for traceability (e.g. "6a-a"). */
  id: string;
  label: string;
  area: number;                 // SqFt
  uValue: number;               // U-Value (Table 2A or NFRC)
  shgc: number;                 // Solar Heat Gain Coefficient
  /** PSF from Table 3D-2 for this latitude × direction. */
  psf: number;
  /** CLF_avg from Table 3D-3 for this latitude × direction. */
  clfAvg: number;
  /** ISC (Internal Shade Coefficient) from Table 3D-4 / OEM data. */
  isc: number;
  /** Insect-screen / projection adjustment factor (1.0 if none).
   *  Outdoor full = 0.80, outdoor half = 0.90, indoor full = 0.90,
   *  indoor half = 0.95. */
  screenAdjustment: number;
  /** Sun-screen shading coefficient (only when sunScreen=true). */
  scSS?: number;
  /** True = window has external sun screen (uses HTM_SS formula). */
  sunScreen?: boolean;
  /** True = window is fully shaded by overhang (HTM_OH = AHTM_N). */
  overhangFullyShaded?: boolean;
  /** PSF for North-equivalent (used for sunScreen / overhang AHTM_N). */
  psfNorth?: number;
  clfNorth?: number;
  /** Override for HTM_c when a more precise value (e.g. Table 3E-1
   *  partial-shade overhang HTM_OH) has already been computed externally.
   *  Smith's South-facing overhangs use this — full Table 3E-1 partial-
   *  shade geometry is a future engine extension. */
  htmCoolingOverride?: number;
}

export interface WindowResult {
  htmHeating: number;           // U × HTD
  htmCooling: number;           // AHTM_D, AHTM_OH, or HTM_SS depending on shading
  heatLoad: number;             // htmHeating × area
  sensLoad: number;             // htmCooling × area
}

// ============================================================================
// Worksheet C — Skylight HTM
// ============================================================================

export interface SkylightInput {
  id: string;
  label: string;
  /** NFRC-rated flat panel area (SqFt). For domed skylights, the
   *  worksheet's Apanel = flatArea × 1.25 curvature adjustment. */
  flatArea: number;
  /** True = domed skylight (applies the 1.25 curvature adjustment). */
  domed?: boolean;
  uNFRC: number;
  shgc: number;
  /** Tilt angle in degrees (typically 30° for residential). */
  tilt: number;
  /** Curb dimensions (inside-of-curb panel L × W). */
  curbLength: number;
  curbWidth: number;
  /** Curb height in inches. */
  curbHeightIn: number;
  /** Light shaft vertical height (ft). */
  shaftHeightFt: number;
  /** R-value of light shaft wall insulation. */
  shaftRValue: number;
  /** PSF horizontal at this latitude (Table 3D-2). */
  psfH: number;
  /** CLF_avg horizontal (Table 3D-3). */
  clfH: number;
  /** PSF vertical for skylight's facing direction (Table 3D-2). */
  psfV: number;
  /** CLF_avg vertical (Table 3D-3). */
  clfV: number;
  /** Internal shade coefficient — typically 1.00 for skylights. */
  isc: number;
}

export interface SkylightResult {
  ueff: number;                 // Combined panel + curb + shaft U
  htmHeating: number;           // Ueff × HTD
  htmCooling: number;           // Solar + (Ueff × (CTD + 15))
  heatLoad: number;
  sensLoad: number;
}

// ============================================================================
// Worksheet D — Opaque panel HTM
// ============================================================================

export interface OpaqueInput {
  id: string;
  label: string;
  constructionId: string;       // Lookup key into Construction registry
  area: number;                 // SqFt (or feet for slab)
  /** True = this construction is being used as a partition (indoor → buffer
   *  space). Engine looks up PTDH/PTDC instead of HTD/CLTD. */
  asPartition?: boolean;
  /** Override PTDH from a different construction reference. Smith's case:
   *  the 15A-4sffc partition wall uses PTDH=6.6 from Construction 19B-osp
   *  per Worksheet D Note 4 (the partition shares temp diff with the floor
   *  over the same crawl space). */
  ptdhOverride?: number;
  /** Override PTDC similarly. Cobb-style block partition with explicit
   *  partition CLTD different from the construction's Group lookup. */
  ptdcOverride?: number;
  /** Floor depth for below-grade walls (Construction 15). */
  basementFloorDepthFt?: number;
}

export interface OpaqueResult {
  htmHeating: number;
  htmCooling: number;
  heatLoad: number;
  sensLoad: number;
}

// ============================================================================
// Worksheet E — Infiltration
// ============================================================================

/** Infiltration estimation method per Worksheet E. */
export type InfiltrationMethod =
  | 'table_5A_ACH'           // Option 1 — default Table 5A
  | 'track_record_ACH'       // Option 1 with custom ACH
  | 'component_leakage'      // Option 2 — Table 5C ELA4 method
  | 'blower_door';           // Option 3 — measured ELA4

export interface InfiltrationInput {
  method: InfiltrationMethod;
  floorArea: number;
  aboveGradeVolume: number;     // CuFt
  /** ACH for heating/cooling (Options 1 / track-record). */
  achHeating?: number;
  achCooling?: number;
  /** Effective leakage area in SqIn (Options 2 / 3). */
  ela4SqIn?: number;
  /** Default heating wind velocity 15 MPH, cooling 7.5 MPH. */
  windHeatMPH?: number;
  windCoolMPH?: number;
  /** Stack and wind coefficients from Table 5D for this shielding class. */
  Cs?: number;
  Cw?: number;
  /** CFM imbalance: CFM_exhaust − CFM_OA. Drives NCFM space-pressure logic. */
  cfmImbalance: number;
  fireplaceCFM?: number;
}

export interface InfiltrationResult {
  icfmHeating: number;
  icfmCooling: number;
  ncfmHeating: number;
  ncfmCooling: number;
  heatLoad: number;
  sensLoad: number;
  latentLoad: number;
}

// ============================================================================
// Worksheet F — Internal loads
// ============================================================================

export interface CustomAppliance {
  name: string;
  sensible: number;             // Btuh after load × use factors applied
  latent?: number;
}

export interface InternalLoadsInput {
  occupants: number;
  /** Default 230 Btuh sensible + 200 Btuh latent per occupant (Manual J). */
  sensiblePerOccupant?: number;
  latentPerOccupant?: number;
  /** Worksheet F default scenario number (0 = none, 1, 2, etc). */
  scenarioOption?: number;
  /** Sensible load from chosen default scenario. */
  scenarioSensible?: number;
  customAppliances?: CustomAppliance[];
}

export interface InternalLoadsResult {
  occupantSens: number;
  occupantLat: number;
  scenarioSens: number;
  customSens: number;
  customLat: number;
  totalSens: number;
  totalLat: number;
}

// ============================================================================
// Worksheet G — Duct loads
// ============================================================================

export interface DuctInput {
  /** Where the duct system is located (drives Table 7 selection). */
  location: 'closed_crawlspace' | 'closed_ceiling_cavity' | 'vented_attic' | 'conditioned' | 'other';
  /** Fraction of duct system in unconditioned space (0–1). */
  percentInUnconditioned: number;
  rValue: number;
  /** Leakage rating, e.g. "0.35/0.70", "0.12/0.24". */
  leakage: string;
  /** Base case factors from Table 7 (interpolation permitted). */
  baseHeatLossFactor: number;
  baseSensGainFactor: number;
  baseLatentGain: number;
  /** R-value WIF correction. */
  wifHeatLoss: number;
  wifSensGain: number;
  /** Leakage Rate Correction. */
  lcfHeatLoss: number;
  lcfSensGain: number;
  lcfLatentGain: number;
  /** True if the system has no heating ducts (e.g. radiant floor) →
   *  EHLF forced to 0 regardless of base factor. */
  heatingViaRadiant?: boolean;
}

export interface DuctFactors {
  EHLF: number;                 // Effective Heat Loss Factor
  ESGF: number;                 // Effective Sensible Gain Factor
  ELG: number;                  // Effective Latent Gain (Btuh)
}

// ============================================================================
// Worksheet H — Ventilation
// ============================================================================

export interface VentilationInput {
  vcfm: number;                 // Ventilation CFM
  /** True = system has a heat recovery ventilator (HRV/ERV). */
  hasHeatRecovery: boolean;
  /** SER for heating (sensible effectiveness, 0 if no HRV). */
  serHeating?: number;
  /** SER for cooling. */
  serCooling?: number;
  /** LER (latent effectiveness, 0 for sensible-only HRV, > 0 for ERV). */
  ler?: number;
  /** True = balanced exhaust + supply (no pressure imbalance). */
  balanced?: boolean;
}

export interface VentilationResult {
  /** Leaving Air Temperature on heating (after HRV pre-warm). */
  latLoss: number;
  latGain: number;
  vGrains: number;              // Effective grain delta after LER
  heatLoad: number;
  sensLoad: number;
  latentLoad: number;
}

// ============================================================================
// Worksheet I — Ancillary loads (humidification + blower)
// ============================================================================

export interface AncillaryInput {
  /** Indoor grains target (e.g. 22.5 at 70°F / 20% RH). */
  indoorGrains?: number;
  /** Outdoor grains baseline. */
  outdoorGrains?: number;
  /** Total CFM for humidification calc (NCFM_heating + VCFM). */
  totalCFM?: number;
  /** Blower motor watts (default 500 if not measured). */
  blowerWatts?: number;
}

export interface AncillaryResult {
  humidificationLoad: number;
  blowerSens: number;
}

// ============================================================================
// Form J1 — full block load aggregation
// ============================================================================

export interface FormJ1Input {
  conditions: DesignConditions;
  windows: WindowInput[];
  skylights: SkylightInput[];
  doors: OpaqueInput[];
  aboveGradeWalls: OpaqueInput[];
  partitionWalls: OpaqueInput[];
  belowGradeWalls: OpaqueInput[];
  ceilings: OpaqueInput[];
  partitionCeilings: OpaqueInput[];
  passiveFloors: OpaqueInput[];
  partitionFloors: OpaqueInput[];
  radiantFloors: OpaqueInput[];
  infiltration: InfiltrationInput;
  internal: InternalLoadsInput;
  ducts: DuctInput;
  ventilation: VentilationInput;
  ancillary: AncillaryInput;
  /** AED block excursion (computed by AED engine, added to Line 20). */
  aedBlockExcursion?: number;
  /** Latent moisture migration (humid climates). */
  latentMoistureMigration?: number;
  adjustments: AdjustmentContext;
}

export interface FormJ1LineItem {
  id: string;
  label: string;
  htmHeating?: number;
  htmCooling?: number;
  area?: number;
  heatLoad: number;
  sensLoad: number;
  latentLoad: number;
}

export interface FormJ1Result {
  conditions: DesignConditions;
  /** Line-by-line breakdown for permit-ready report generation. */
  lineItems: FormJ1LineItem[];
  /** Subtotal (Line 14) — envelope + infiltration + internal. */
  line14: { heat: number; sens: number; latent: number };
  /** Duct factors + applied loads (Line 15). */
  ductFactors: DuctFactors;
  ductLoads: { heat: number; sens: number; latent: number };
  /** Ventilation loads (Line 16). */
  ventLoads: { heat: number; sens: number; latent: number };
  humidificationLoad: number;   // Line 17
  blowerHeat: number;           // Line 19
  aedExcursion: number;         // Line 20 (sensible)
  moistureMigration: number;    // Line 20 (latent)
  /** Final total loads (Line 21) — equipment sizing values. */
  total: { heat: number; sens: number; latent: number };
  /** Sensible Heat Ratio for cooling (sens / (sens + latent)). */
  sensibleHeatRatio: number;
}
