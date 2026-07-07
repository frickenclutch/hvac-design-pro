/**
 * HVAC Cost Estimation Engine
 *
 * Generates material and labor cost estimates from Manual J calculation results.
 * Uses industry-average pricing tables — NOT retailer-specific pricing.
 *
 * DISCLAIMER: All estimates are approximate. Actual costs vary by region,
 * supplier, equipment brand, and installation complexity. Always obtain
 * a formal quote from your HVAC distributor.
 */

import type { WholeHouseResult, DesignConditions, DuctLocation } from './manualJ';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SystemType = 'heat_pump' | 'ac_furnace' | 'mini_split' | 'packaged';

export interface LineItem {
  category: 'equipment' | 'ductwork' | 'controls' | 'labor' | 'permits' | 'misc';
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface CostEstimate {
  systemType: SystemType;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  lowRange: number;
  highRange: number;
  tonnage: number;
  generatedAt: string;
  disclaimer: string;
  /** Regional adjustment applied, so the UI can show "localized for NJ". */
  region: {
    state: string | null;
    laborIndex: number;   // multiplier vs national average (1.0 = national)
    localized: boolean;   // true when a state-specific index/tax was applied
  };
}

/**
 * Approximate state labor-cost index for HVAC installation vs. the national
 * average (1.0). Regional labor is the single largest driver of install-cost
 * variation, so it is what we localize. Values are ballpark (RSMeans-style
 * city cost indices, state-rolled) and clearly disclaimed — not a quote.
 * Unlisted states default to 1.0.
 */
const STATE_LABOR_INDEX: Record<string, number> = {
  AK: 1.28, AL: 0.86, AR: 0.85, AZ: 0.98, CA: 1.22, CO: 1.02, CT: 1.15, DC: 1.15,
  DE: 1.02, FL: 0.95, GA: 0.92, HI: 1.30, IA: 0.96, ID: 0.95, IL: 1.10, IN: 0.97,
  KS: 0.93, KY: 0.88, LA: 0.90, MA: 1.18, MD: 1.08, ME: 1.00, MI: 1.02, MN: 1.05,
  MO: 0.96, MS: 0.85, MT: 0.96, NC: 0.90, ND: 0.98, NE: 0.94, NH: 1.03, NJ: 1.13,
  NM: 0.93, NV: 1.03, NY: 1.20, OH: 1.00, OK: 0.87, OR: 1.06, PA: 1.05, RI: 1.12,
  SC: 0.90, SD: 0.93, TN: 0.88, TX: 0.94, UT: 0.97, VA: 0.97, VT: 1.02, WA: 1.10,
  WI: 1.01, WV: 0.93, WY: 0.96,
};

/**
 * Approximate combined (state + typical local) sales-tax rate applied to the
 * taxable material/equipment portion. Labor and permits are excluded from the
 * tax base below. Ballpark, disclaimed. Unlisted → 7% national placeholder.
 */
const STATE_SALES_TAX: Record<string, number> = {
  AK: 0.018, AL: 0.092, AR: 0.094, AZ: 0.084, CA: 0.0875, CO: 0.077, CT: 0.0635,
  DC: 0.06, DE: 0.0, FL: 0.07, GA: 0.073, HI: 0.045, IA: 0.069, ID: 0.06, IL: 0.089,
  IN: 0.07, KS: 0.087, KY: 0.06, LA: 0.0955, MA: 0.0625, MD: 0.06, ME: 0.055,
  MI: 0.06, MN: 0.075, MO: 0.082, MS: 0.07, MT: 0.0, NC: 0.069, ND: 0.069,
  NE: 0.069, NH: 0.0, NJ: 0.06625, NM: 0.078, NV: 0.083, NY: 0.085, OH: 0.072,
  OK: 0.089, OR: 0.0, PA: 0.063, RI: 0.07, SC: 0.075, SD: 0.064, TN: 0.0955,
  TX: 0.0825, UT: 0.072, VA: 0.057, VT: 0.062, WA: 0.093, WI: 0.055, WV: 0.065,
  WY: 0.054,
};

// ═══════════════════════════════════════════════════════════════════════════════
// COST TABLES
// ═══════════════════════════════════════════════════════════════════════════════

/** Equipment cost by tonnage — [heat_pump, ac_furnace, mini_split, packaged] */
const EQUIPMENT_COST: Record<number, Record<SystemType, number>> = {
  1.5: { heat_pump: 3400, ac_furnace: 2900, mini_split: 3000, packaged: 3200 },
  2.0: { heat_pump: 4000, ac_furnace: 3400, mini_split: 3600, packaged: 3800 },
  2.5: { heat_pump: 4600, ac_furnace: 3900, mini_split: 4200, packaged: 4400 },
  3.0: { heat_pump: 5200, ac_furnace: 4400, mini_split: 5000, packaged: 5000 },
  3.5: { heat_pump: 5900, ac_furnace: 5100, mini_split: 5800, packaged: 5600 },
  4.0: { heat_pump: 6600, ac_furnace: 5700, mini_split: 6800, packaged: 6300 },
  5.0: { heat_pump: 8000, ac_furnace: 7000, mini_split: 8500, packaged: 7800 },
};

/** Ductwork material cost per linear foot by duct location */
const DUCT_COST_PER_FT: Record<DuctLocation, number> = {
  conditioned: 12,
  attic: 18,
  crawlspace: 16,
  garage: 15,
  basement_uncond: 14,
};

/** Labor multiplier by duct location (attic/crawlspace more expensive) */
const LABOR_MULTIPLIER: Record<DuctLocation, number> = {
  conditioned: 0.35,
  attic: 0.50,
  crawlspace: 0.48,
  garage: 0.40,
  basement_uncond: 0.38,
};

// ═══════════════════════════════════════════════════════════════════════════════
// ESTIMATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find the closest matching tonnage from our cost table.
 */
function closestTonnage(tons: number): number {
  const keys = Object.keys(EQUIPMENT_COST).map(Number).sort((a, b) => a - b);
  let closest = keys[0];
  let minDiff = Math.abs(tons - closest);
  for (const k of keys) {
    const diff = Math.abs(tons - k);
    if (diff < minDiff) {
      closest = k;
      minDiff = diff;
    }
  }
  return closest;
}

export function generateCostEstimate(
  result: WholeHouseResult,
  conditions: DesignConditions,
  systemType: SystemType = 'heat_pump',
  state: string | null = null,
): CostEstimate {
  const stateKey = state?.toUpperCase().trim() || null;
  const laborIndex = (stateKey && STATE_LABOR_INDEX[stateKey]) || 1.0;
  const taxRate = (stateKey && STATE_SALES_TAX[stateKey] != null) ? STATE_SALES_TAX[stateKey] : 0.07;
  const localized = !!(stateKey && (STATE_LABOR_INDEX[stateKey] != null || STATE_SALES_TAX[stateKey] != null));

  const tonnage = result.recommendedTons;
  const matchTon = closestTonnage(tonnage);
  const lineItems: LineItem[] = [];

  // 1. Primary Equipment
  const equipmentCost = EQUIPMENT_COST[matchTon][systemType];
  lineItems.push({
    category: 'equipment',
    description: `${formatSystemType(systemType)} — ${tonnage} Ton (${result.totalCoolingBtu.toLocaleString()} BTU/hr)`,
    quantity: 1,
    unitCost: equipmentCost,
    totalCost: equipmentCost,
  });

  // 2. Air Handler / Indoor Unit (for split systems)
  if (systemType !== 'packaged') {
    const handlerCost = Math.round(equipmentCost * 0.35);
    lineItems.push({
      category: 'equipment',
      description: 'Air Handler / Indoor Unit',
      quantity: 1,
      unitCost: handlerCost,
      totalCost: handlerCost,
    });
  }

  // 3. Ductwork
  const ductCostPerFt = DUCT_COST_PER_FT[conditions.ductLocation];
  const ductLength = conditions.ductLengthFt || 80;
  if (systemType !== 'mini_split') {
    lineItems.push({
      category: 'ductwork',
      description: `Supply & Return Ductwork (${conditions.ductLocation} — R-${conditions.ductInsulationR})`,
      quantity: ductLength,
      unitCost: ductCostPerFt,
      totalCost: ductLength * ductCostPerFt,
    });

    // Duct fittings, boots, registers — estimated at 40% of duct material
    const fittingsCost = Math.round(ductLength * ductCostPerFt * 0.4);
    lineItems.push({
      category: 'ductwork',
      description: 'Fittings, Boots, Registers & Grilles',
      quantity: 1,
      unitCost: fittingsCost,
      totalCost: fittingsCost,
    });
  }

  // 4. Refrigerant Line Set
  lineItems.push({
    category: 'misc',
    description: 'Refrigerant Line Set (insulated)',
    quantity: 1,
    unitCost: 225,
    totalCost: 225,
  });

  // 5. Thermostat / Controls
  lineItems.push({
    category: 'controls',
    description: 'Programmable Thermostat (WiFi)',
    quantity: 1,
    unitCost: 350,
    totalCost: 350,
  });

  // 6. Condensate Drain Kit
  lineItems.push({
    category: 'misc',
    description: 'Condensate Drain & Safety Switch',
    quantity: 1,
    unitCost: 85,
    totalCost: 85,
  });

  // 7. Filter Media
  lineItems.push({
    category: 'misc',
    description: 'MERV-13 Filter (initial set)',
    quantity: 2,
    unitCost: 22,
    totalCost: 44,
  });

  // 8. Labor — scaled by the regional labor-cost index (the largest source
  // of geographic cost variation).
  const materialSubtotal = lineItems.reduce((s, li) => s + li.totalCost, 0);
  const laborRate = LABOR_MULTIPLIER[conditions.ductLocation];
  const laborCost = Math.round(materialSubtotal * laborRate * laborIndex);
  const laborRegionNote = laborIndex !== 1.0
    ? ` — ${stateKey} regional index ×${laborIndex.toFixed(2)}`
    : '';
  lineItems.push({
    category: 'labor',
    description: `Installation Labor (${conditions.ductLocation} duct routing)${laborRegionNote}`,
    quantity: 1,
    unitCost: laborCost,
    totalCost: laborCost,
  });

  // 9. Permits
  const permitCost = 350;
  lineItems.push({
    category: 'permits',
    description: 'Mechanical Permit (typical)',
    quantity: 1,
    unitCost: permitCost,
    totalCost: permitCost,
  });

  // Totals
  const subtotal = lineItems.reduce((s, li) => s + li.totalCost, 0);
  const tax = Math.round(
    lineItems
      .filter(li => li.category !== 'labor' && li.category !== 'permits')
      .reduce((s, li) => s + li.totalCost, 0) * taxRate
  );
  const total = subtotal + tax;

  return {
    systemType,
    lineItems,
    subtotal,
    taxRate,
    tax,
    total,
    lowRange: Math.round(total * 0.85),
    highRange: Math.round(total * 1.20),
    tonnage,
    generatedAt: new Date().toISOString(),
    disclaimer:
      'This is an approximate cost estimate based on industry-average pricing' +
      (localized ? `, regionally adjusted for ${stateKey}` : '') +
      '. Actual costs vary by region, equipment brand, and installation complexity. ' +
      'Contact your preferred HVAC distributor for a formal project quote.',
    region: { state: stateKey, laborIndex, localized },
  };
}

function formatSystemType(st: SystemType): string {
  switch (st) {
    case 'heat_pump': return 'Heat Pump System';
    case 'ac_furnace': return 'A/C + Gas Furnace';
    case 'mini_split': return 'Ductless Mini-Split';
    case 'packaged': return 'Packaged Unit';
  }
}

/** All available system types with labels */
export const SYSTEM_TYPE_OPTIONS: { value: SystemType; label: string }[] = [
  { value: 'heat_pump', label: 'Heat Pump' },
  { value: 'ac_furnace', label: 'A/C + Furnace' },
  { value: 'mini_split', label: 'Mini-Split' },
  { value: 'packaged', label: 'Packaged Unit' },
];
