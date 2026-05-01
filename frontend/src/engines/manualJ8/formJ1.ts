/**
 * Manual J 8th Edition — Form J1 (Block Load Aggregator)
 * ========================================================
 * Source: ACCA Manual J 8th Edition v2.50, Form J1
 *
 * The block-load summary that all worksheets feed into. Produces the
 * 21-line summary that goes on permit applications:
 *
 *   Lines 1-5:   Project / geometry headers
 *   Lines 6a:    Windows + glass doors
 *   Lines 6b:    Skylights
 *   Line 7:      Wood and metal doors
 *   Line 8:      Above-grade walls (incl. partition walls)
 *   Line 9:      Below-grade walls
 *   Line 10:     Ceilings
 *   Line 11:     Floors (incl. radiant — added to TOTAL not subtotal)
 *   Line 12:     Infiltration
 *   Line 13:     Internal loads (occupants + scenarios + appliances)
 *   Line 14:     SUBTOTAL — sum of envelope contributions
 *   Line 15:     Duct loads (factor × Line 14)
 *   Line 16:     Ventilation loads
 *   Line 17:     Winter humidification load
 *   Line 18:     Piping load
 *   Line 19:     Blower heat
 *   Line 20:     AED excursion + latent moisture migration
 *   Line 21:     TOTAL LOAD (equipment sizing values)
 *
 * Validated against three ACCA reference test cases — see __tests__/.
 */

import type {
  FormJ1Input, FormJ1Result, FormJ1LineItem,
} from './types';
import { calculateWindow } from './worksheets/windows';
import { calculateSkylight } from './worksheets/skylights';
import { calculateOpaque } from './worksheets/opaque';
import { calculateInfiltration } from './worksheets/infiltration';
import { calculateInternalLoads } from './worksheets/internal';
import { calculateDuctFactors } from './worksheets/ducts';
import { calculateVentilation } from './worksheets/ventilation';
import { calculateAncillary } from './worksheets/ancillary';

export function buildFormJ1(input: FormJ1Input): FormJ1Result {
  const c = input.conditions;
  const lineItems: FormJ1LineItem[] = [];

  // Helper to compute element sums while building line items
  const sumLine = () => ({ heat: 0, sens: 0, latent: 0 });

  // ── Line 6a — Windows ────────────────────────────────────────────────
  const windowsTotal = sumLine();
  for (const w of input.windows) {
    const r = calculateWindow(w, c.HTD, c.CTD);
    lineItems.push({
      id: w.id, label: w.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: w.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    windowsTotal.heat += r.heatLoad;
    windowsTotal.sens += r.sensLoad;
  }

  // ── Line 6b — Skylights ──────────────────────────────────────────────
  const skylightsTotal = sumLine();
  for (const s of input.skylights) {
    const r = calculateSkylight(s, c.HTD, c.CTD);
    lineItems.push({
      id: s.id, label: s.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: s.flatArea, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    skylightsTotal.heat += r.heatLoad;
    skylightsTotal.sens += r.sensLoad;
  }

  // ── Line 7 — Doors ───────────────────────────────────────────────────
  const doorsTotal = sumLine();
  for (const d of input.doors) {
    const r = calculateOpaque(d, c.CTD, c.HTD, c.dailyRange);
    lineItems.push({
      id: d.id, label: d.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: d.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    doorsTotal.heat += r.heatLoad;
    doorsTotal.sens += r.sensLoad;
  }

  // ── Line 8 — Above-grade walls + partitions ─────────────────────────
  const wallsTotal = sumLine();
  for (const w of input.aboveGradeWalls) {
    const r = calculateOpaque(w, c.CTD, c.HTD, c.dailyRange);
    lineItems.push({
      id: w.id, label: w.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: w.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    wallsTotal.heat += r.heatLoad;
    wallsTotal.sens += r.sensLoad;
  }
  for (const p of input.partitionWalls) {
    const r = calculateOpaque({ ...p, asPartition: true }, c.CTD, c.HTD, c.dailyRange);
    lineItems.push({
      id: p.id, label: p.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: p.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    wallsTotal.heat += r.heatLoad;
    wallsTotal.sens += r.sensLoad;
  }

  // ── Line 9 — Below-grade walls (heating only) ───────────────────────
  const belowWallsTotal = sumLine();
  for (const bw of input.belowGradeWalls) {
    const r = calculateOpaque(bw, c.CTD, c.HTD, c.dailyRange);
    lineItems.push({
      id: bw.id, label: bw.label,
      htmHeating: r.htmHeating, htmCooling: 0,
      area: bw.area, heatLoad: r.heatLoad, sensLoad: 0, latentLoad: 0,
    });
    belowWallsTotal.heat += r.heatLoad;
  }

  // ── Line 10 — Ceilings + partition ceilings ─────────────────────────
  const ceilingsTotal = sumLine();
  for (const ce of [...input.ceilings, ...input.partitionCeilings]) {
    const isPartition = input.partitionCeilings.includes(ce);
    const r = calculateOpaque(
      { ...ce, asPartition: isPartition }, c.CTD, c.HTD, c.dailyRange,
    );
    lineItems.push({
      id: ce.id, label: ce.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: ce.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    ceilingsTotal.heat += r.heatLoad;
    ceilingsTotal.sens += r.sensLoad;
  }

  // ── Line 11 — Passive + partition floors ────────────────────────────
  // (Radiant floors handled separately — added to TOTAL not subtotal)
  const floorsTotal = sumLine();
  for (const f of [...input.passiveFloors, ...input.partitionFloors]) {
    const isPartition = input.partitionFloors.includes(f);
    const r = calculateOpaque(
      { ...f, asPartition: isPartition }, c.CTD, c.HTD, c.dailyRange,
    );
    lineItems.push({
      id: f.id, label: f.label,
      htmHeating: r.htmHeating, htmCooling: r.htmCooling,
      area: f.area, heatLoad: r.heatLoad, sensLoad: r.sensLoad, latentLoad: 0,
    });
    floorsTotal.heat += r.heatLoad;
    floorsTotal.sens += r.sensLoad;
  }
  // Radiant floor heating (Manual J Construction 22 radiant) — adds to TOTAL
  let radiantHeat = 0;
  for (const rf of input.radiantFloors) {
    const r = calculateOpaque(rf, c.CTD, c.HTD, c.dailyRange);
    lineItems.push({
      id: rf.id, label: `${rf.label} (added to total, not subtotal)`,
      htmHeating: r.htmHeating, htmCooling: 0,
      area: rf.area, heatLoad: r.heatLoad, sensLoad: 0, latentLoad: 0,
    });
    radiantHeat += r.heatLoad;
  }

  // ── Line 12 — Infiltration ──────────────────────────────────────────
  const infil = calculateInfiltration(
    input.infiltration, c.HTD, c.CTD, c.deltaGrains, c.ACF,
  );
  lineItems.push({
    id: 'L12', label: 'Infiltration',
    heatLoad: infil.heatLoad, sensLoad: infil.sensLoad, latentLoad: infil.latentLoad,
  });

  // ── Line 13 — Internal loads ────────────────────────────────────────
  const internal = calculateInternalLoads(input.internal);
  lineItems.push({
    id: 'L13', label: 'Internal loads',
    heatLoad: 0,  // Internal loads don't reduce heating in Manual J
    sensLoad: internal.totalSens,
    latentLoad: internal.totalLat,
  });

  // ── Line 14 — Subtotal (envelope + infiltration + internal) ─────────
  const line14 = {
    heat:
      windowsTotal.heat + skylightsTotal.heat + doorsTotal.heat +
      wallsTotal.heat + belowWallsTotal.heat + ceilingsTotal.heat +
      floorsTotal.heat + infil.heatLoad,
    sens:
      windowsTotal.sens + skylightsTotal.sens + doorsTotal.sens +
      wallsTotal.sens + ceilingsTotal.sens + floorsTotal.sens +
      infil.sensLoad + internal.totalSens,
    latent: infil.latentLoad + internal.totalLat,
  };

  // ── Line 15 — Duct loads ────────────────────────────────────────────
  const ductFactors = calculateDuctFactors(input.ducts);
  const ductLoads = {
    heat: ductFactors.EHLF * line14.heat,
    sens: ductFactors.ESGF * line14.sens,
    latent: ductFactors.ELG,
  };

  // ── Line 16 — Ventilation ───────────────────────────────────────────
  const vent = calculateVentilation(input.ventilation, c);
  const ventLoads = {
    heat: vent.heatLoad,
    sens: vent.sensLoad,
    latent: vent.latentLoad,
  };

  // ── Line 17 + Line 19 — Humidification + Blower ─────────────────────
  // Default totalCFM for humidification = NCFM_heating + VCFM
  const ancInput = {
    ...input.ancillary,
    totalCFM: input.ancillary.totalCFM ??
      (infil.ncfmHeating + (input.ventilation.vcfm ?? 0)),
  };
  const ancillary = calculateAncillary(ancInput, c.ACF);

  // ── Line 20 — AED + latent moisture migration ──────────────────────
  const aedExcursion = input.aedBlockExcursion ?? 0;
  const moistureMigration = input.latentMoistureMigration ?? 0;

  // ── Line 21 — Totals ────────────────────────────────────────────────
  const total = {
    heat:   line14.heat   + ductLoads.heat   + ventLoads.heat   + ancillary.humidificationLoad + radiantHeat,
    sens:   line14.sens   + ductLoads.sens   + ventLoads.sens   + ancillary.blowerSens + aedExcursion,
    latent: line14.latent + ductLoads.latent + ventLoads.latent + moistureMigration,
  };

  const sensibleHeatRatio =
    total.sens + total.latent === 0
      ? 1
      : total.sens / (total.sens + total.latent);

  return {
    conditions: c,
    lineItems,
    line14,
    ductFactors,
    ductLoads,
    ventLoads,
    humidificationLoad: ancillary.humidificationLoad,
    blowerHeat: ancillary.blowerSens,
    aedExcursion,
    moistureMigration,
    total,
    sensibleHeatRatio,
  };
}
