/**
 * Recognise the placeholder forms older builds saved just by opening a page.
 *
 * Manual S used to open on a made-up house and a made-up unit, Manual D on a
 * single "Room 1 / 100 CFM / 20 ft" run, and both wrote that to storage on
 * mount. Those blobs are still in users' browsers. Nothing may treat them as a
 * project's real selection or duct design — not the pages when they reload,
 * and not the combined report when it decides which sections have data.
 */

interface ManualSLike {
  loadsSource?: unknown;
  totalCoolingBtu?: unknown;
  sensibleCoolingBtu?: unknown;
  heatingBtu?: unknown;
  coolTotalCap?: unknown;
  coolSensCap?: unknown;
  heatCap?: unknown;
  coolingModel?: unknown;
  ahriRef?: unknown;
  heatingModel?: unknown;
}

export function isManualSPlaceholder(s: ManualSLike): boolean {
  return (s.loadsSource ?? 'manual') === 'manual'
    && s.totalCoolingBtu === 36000 && s.sensibleCoolingBtu === 27000 && s.heatingBtu === 45000
    && s.coolTotalCap === 38000 && s.coolSensCap === 28000 && s.heatCap === 50000
    && !s.coolingModel && !s.ahriRef && !s.heatingModel;
}

interface ManualDLike {
  equipmentCfm?: unknown;
  blowerEsp?: unknown;
  filterDrop?: unknown;
  coilDrop?: unknown;
  rooms?: Array<{ roomName?: unknown; requiredCfm?: unknown; actualLengthFt?: unknown }> | unknown;
}

export function isManualDPlaceholder(s: ManualDLike): boolean {
  if (!Array.isArray(s.rooms) || s.rooms.length !== 1) return false;
  const [run] = s.rooms as Array<{ roomName?: unknown; requiredCfm?: unknown; actualLengthFt?: unknown }>;
  return s.equipmentCfm === 1200 && s.blowerEsp === 0.5 && s.filterDrop === 0.1 && s.coilDrop === 0.2
    && run.roomName === 'Room 1' && run.requiredCfm === 100 && run.actualLengthFt === 20;
}

interface AedGroupLike { orientation?: unknown; areaSqFt?: unknown; shgc?: unknown; interiorShading?: unknown }

/** The invented S64 / W24 / E18 / N12 house the AED page used to open on. */
export function isAedPlaceholder(groups: unknown): boolean {
  if (!Array.isArray(groups) || groups.length !== 4) return false;
  const expected: Array<[string, number]> = [['S', 64], ['W', 24], ['E', 18], ['N', 12]];
  return (groups as AedGroupLike[]).every((g, i) =>
    g.orientation === expected[i][0] && g.areaSqFt === expected[i][1] && g.shgc === 0.25 && g.interiorShading === 0.7);
}
