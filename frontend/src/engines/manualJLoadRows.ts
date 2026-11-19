/**
 * Whole-house reconciliation rows for the Manual J room table.
 *
 * The room rows are raw room loads; the TOTAL row also contains mechanical
 * ventilation, the AED excursion and duct losses, none of which belong to a
 * single room. Printed without them the column does not add up to its own
 * total, which is the first thing a plan reviewer checks. These rows are the
 * difference, derived only from values the engine already reports, so
 * rooms + ventilation + AED + ducts = TOTAL exactly.
 */

import type { WholeHouseResult } from './manualJ';

export interface LoadRow {
  key: 'rooms' | 'ventilation' | 'aed' | 'ducts';
  label: string;
  heatingBtu: number;
  coolingBtuSensible: number;
  coolingBtuLatent: number;
  coolingBtuTotal: number;
}

export function wholeHouseLoadRows(wh: WholeHouseResult): LoadRow[] {
  const sum = (pick: (r: WholeHouseResult['rooms'][number]) => number) =>
    wh.rooms.reduce((s, r) => s + pick(r), 0);
  const roomsH = sum(r => r.heatingBtu);
  const roomsS = sum(r => r.coolingBtuSensible);
  const roomsL = sum(r => r.coolingBtuLatent);

  const ventH = wh.ventilationSensible;         // heating-side outdoor-air load
  const ventL = wh.ventilationLatent;
  const aedS = Math.max(0, wh.aed?.excursion ?? 0);

  // Duct loss is reported for heating and for cooling as a whole; split the
  // cooling figure by removing its latent share (latent is rooms + ventilation
  // before the duct factor is applied).
  const ductH = wh.ductLossHeating;
  const ductL = wh.totalCoolingLatent - (roomsL + ventL);
  const ductS = wh.ductLossCooling - ductL;
  // Ventilation's cooling-sensible share is what remains of the sensible total.
  const ventS = wh.totalCoolingSensible - ductS - aedS - roomsS;

  const row = (key: LoadRow['key'], label: string, h: number, s: number, l: number): LoadRow => ({
    key, label, heatingBtu: h, coolingBtuSensible: s, coolingBtuLatent: l, coolingBtuTotal: s + l,
  });

  const rows: LoadRow[] = [
    row('rooms', 'Rooms subtotal', roomsH, roomsS, roomsL),
    row('ventilation', `Ventilation (${Math.round(wh.ventilationCFM)} CFM outdoor air)`, ventH, ventS, ventL),
  ];
  if (aedS > 0) rows.push(row('aed', 'AED excursion', 0, aedS, 0));
  rows.push(row('ducts', 'Duct losses', ductH, ductS, ductL));
  return rows;
}
