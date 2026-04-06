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
}

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
  taxRate: number = 0.07,
): CostEstimate {
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

  // 8. Labor
  const materialSubtotal = lineItems.reduce((s, li) => s + li.totalCost, 0);
  const laborRate = LABOR_MULTIPLIER[conditions.ductLocation];
  const laborCost = Math.round(materialSubtotal * laborRate);
  lineItems.push({
    category: 'labor',
    description: `Installation Labor (${conditions.ductLocation} duct routing)`,
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
      'This is an approximate cost estimate based on industry-average pricing. ' +
      'Actual costs vary by region, equipment brand, and installation complexity. ' +
      'Contact your preferred HVAC distributor for a formal project quote.',
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
