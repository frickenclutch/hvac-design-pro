/**
 * HVAC DesignPro — Combined Report Generator
 *
 * Assembles a single multi-page jsPDF that stitches together every calculator
 * tool that has data for the active project, in the canonical engineering order:
 *
 *   1. Manual J  — load calculation summary + per-room breakdown
 *   2. AED       — Adequate Exposure Diversity (Manual J Section N)
 *   3. Manual S  — equipment selection verdicts
 *   4. Manual D  — duct sizing schedule
 *
 * Each section starts on its own page. A section is included ONLY when the
 * caller passes data for it (the page gathers/recomputes the per-tool results
 * and hands them in). Honors the user's PDF preferences (orientation, page
 * size, watermark text, firm/notary stamp, include* toggles) read via
 * usePreferencesStore.getState().
 *
 * This module is the orchestration layer; it deliberately replicates the
 * lightweight label-pair / table idioms the individual calculator exporters
 * use (ManualJCalculator / ManualSCalculator / ManualDCalculator) rather than
 * the CAD pdfGenerator helpers — those helpers are module-private (not
 * exported) and tightly coupled to the CAD `FloorData` / mm-unit page geometry,
 * so they are not reusable here. The watermark/firm-stamp/footer CONVENTIONS
 * are mirrored faithfully (same preference flags, same engine-stamp footer).
 */

import { usePreferencesStore } from '../../stores/usePreferencesStore';
import type { WholeHouseResult } from '../../engines/manualJ';
import type { AedResult } from '../../engines/aed';
import {
  calculateManualS, coolingStatusLabel, heatingStatusLabel,
  type ManualSResult,
} from '../../engines/manualS';
import {
  calculateManualD,
  type ManualDResult,
} from '../../engines/manualD';

// ─────────────────────────────────────────────────────────────────────────────
// Public input shape
// ─────────────────────────────────────────────────────────────────────────────

/** A tool's already-gathered data, passed in by the page. */
export interface CombinedReportData {
  projectName: string;
  /** Manual J whole-house result (read directly from localStorage results). */
  manualJ?: WholeHouseResult | null;
  /** AED result (read directly from localStorage results). */
  aed?: AedResult | null;
  /** Manual S result — recomputed by the page (or here) from stored inputs. */
  manualS?: ManualSResult | null;
  /** Manual D result — recomputed by the page (or here) from stored inputs. */
  manualD?: ManualDResult | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recompute helpers (exported so the page can show one-line summaries without
// duplicating the input→engine mapping). Each returns null on bad/empty input.
// ─────────────────────────────────────────────────────────────────────────────

/** Flat Manual S persisted-input shape (mirrors ManualSCalculator SavedState). */
export interface StoredManualSInputs {
  totalCoolingBtu: number;
  sensibleCoolingBtu: number;
  heatingBtu: number;
  outdoorCoolingTempF: number;
  outdoorHeatingTempF: number;
  indoorCoolingTempF: number;
  elevationFt: number;
  coolingType: 'ac' | 'heat_pump';
  coolingModel?: string;
  ahriRef?: string;
  coolTotalCap: number;
  coolSensCap: number;
  applyAltitude: boolean;
  heatingType: 'furnace_gas' | 'furnace_electric' | 'heat_pump' | 'none';
  heatingModel?: string;
  heatCap: number;
  cap47?: number;
  cap17?: number;
  afue?: number;
}

/** Recompute a Manual S result from stored flat inputs. */
export function recomputeManualS(
  inputs: StoredManualSInputs,
  systemName: string,
): ManualSResult {
  const total = Number(inputs.totalCoolingBtu) || 0;
  const sensible = Number(inputs.sensibleCoolingBtu) || 0;
  const cap47 = Number(inputs.cap47) || 0;
  const cap17 = Number(inputs.cap17) || 0;
  const afue = Number(inputs.afue) || 0;
  return calculateManualS({
    systemName,
    loads: {
      totalCoolingBtu: total,
      sensibleCoolingBtu: sensible,
      latentCoolingBtu: Math.max(0, total - sensible),
      heatingBtu: Number(inputs.heatingBtu) || 0,
      outdoorCoolingTempF: Number(inputs.outdoorCoolingTempF) || 0,
      outdoorHeatingTempF: Number(inputs.outdoorHeatingTempF) || 0,
      indoorCoolingTempF: Number(inputs.indoorCoolingTempF) || 0,
      elevationFt: Number(inputs.elevationFt) || 0,
    },
    cooling: {
      systemType: inputs.coolingType,
      modelName: inputs.coolingModel || undefined,
      ahriRefNumber: inputs.ahriRef || undefined,
      totalCoolingCapacityBtu: Number(inputs.coolTotalCap) || 0,
      sensibleCoolingCapacityBtu: Number(inputs.coolSensCap) || 0,
      applyAltitudeCorrection: !!inputs.applyAltitude,
    },
    heating: {
      heatingType: inputs.heatingType,
      modelName: inputs.heatingModel || undefined,
      heatingCapacityBtu: Number(inputs.heatCap) || 0,
      heatingCapacityAt47Btu: inputs.heatingType === 'heat_pump' && cap47 > 0 ? cap47 : undefined,
      heatingCapacityAt17Btu: inputs.heatingType === 'heat_pump' && cap17 > 0 ? cap17 : undefined,
      afue: afue > 0 ? afue : undefined,
    },
  });
}

/** Flat Manual D persisted-input shape (mirrors ManualDCalculator SavedState). */
export interface StoredManualDInputs {
  application: 'residential' | 'commercial';
  equipmentCfm: number;
  blowerEsp: number;
  filterDrop: number;
  coilDrop: number;
  ductMaterial: import('../../engines/manualD').DuctMaterial;
  preferredShape: import('../../engines/manualD').DuctShape;
  maxAspectRatio: number;
  rooms: import('../../engines/manualD').ManualDRoomInput[];
}

/** Recompute a Manual D result from stored inputs. Null when there are no runs. */
export function recomputeManualD(
  inputs: StoredManualDInputs,
  systemName: string,
): ManualDResult | null {
  if (!Array.isArray(inputs.rooms) || inputs.rooms.length === 0) return null;
  return calculateManualD({
    systemName,
    equipmentCfm: Number(inputs.equipmentCfm) || 0,
    blowerEspInwg: Number(inputs.blowerEsp) || 0,
    filterDropInwg: Number(inputs.filterDrop) || 0,
    coilDropInwg: Number(inputs.coilDrop) || 0,
    ductMaterial: inputs.ductMaterial,
    preferredShape: inputs.preferredShape,
    maxAspectRatio: Number(inputs.maxAspectRatio) || 4,
    application: inputs.application,
    rooms: inputs.rooms,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF assembly
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number): string => Math.round(n).toLocaleString();

/**
 * Build the combined PDF and trigger a download. Lazy-imports jsPDF so it stays
 * out of the initial bundle, exactly like every calculator exporter does.
 */
export async function generateCombinedReport(data: CombinedReportData): Promise<void> {
  const { default: JsPDF } = await import('jspdf');
  const prefs = usePreferencesStore.getState();

  const orientation = prefs.pdfOrientation === 'portrait' ? 'portrait' : 'landscape';
  const format = prefs.pdfPageSize || 'letter';
  // Use points to match the calculator exporters' coordinate idioms.
  const doc = new JsPDF({ orientation, unit: 'pt', format });

  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 48;
  const dateStr = new Date().toISOString().slice(0, 10);
  const projectName = data.projectName || 'Untitled Project';

  // Which sections actually have data — drives both the cover list + skip logic.
  const sections: { code: string; label: string; present: boolean }[] = [
    { code: 'MJ', label: 'Manual J — Load Calculation', present: !!data.manualJ },
    { code: 'AED', label: 'AED — Adequate Exposure Diversity', present: !!data.aed },
    { code: 'MS', label: 'Manual S — Equipment Selection', present: !!data.manualS },
    { code: 'MD', label: 'Manual D — Duct Design', present: !!data.manualD },
  ];
  const included = sections.filter((s) => s.present);

  // ── Shared footer (engine-stamp convention, matches AED / Manual D / S) ─────
  const drawFooter = (engineLabel: string): void => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(150);
    const watermark = prefs.pdfWatermarkText || 'GENERATED BY HVAC DESIGNPRO';
    doc.text(`${watermark}  —  ${engineLabel}`, margin, ph - 24);
    doc.text(dateStr, pw - margin, ph - 24, { align: 'right' });
    doc.setTextColor(0);
  };

  // ── Firm stamp overlay (honors firmStampDataUrl + firmStampPosition) ────────
  const drawStamp = (): void => {
    if (!prefs.firmStampDataUrl) return;
    const size = 56;
    const posMap: Record<string, [number, number]> = {
      'top-left': [margin, margin],
      'top-right': [pw - margin - size, margin],
      'bottom-left': [margin, ph - margin - size - 28],
      'bottom-right': [pw - margin - size, ph - margin - size - 28],
    };
    const [sx, sy] = posMap[prefs.firmStampPosition] || posMap['bottom-right'];
    try { doc.addImage(prefs.firmStampDataUrl, 'PNG', sx, sy, size, size); } catch { /* skip */ }
  };

  // Reusable label-pair block (mirrors the calculator exporters' pairBlock).
  const pairBlock = (
    startY: number,
    title: string,
    pairs: [string, string][],
  ): number => {
    let y = startY;
    doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    if (y > ph - 60) { doc.addPage(); y = 56; }
    doc.text(title, margin, y); y += 14;
    doc.setFontSize(9);
    pairs.forEach(([label, val]) => {
      if (y > ph - 60) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.text(label, margin, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.text(val, margin + 250, y);
      y += 14;
    });
    return y + 8;
  };

  // ════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ════════════════════════════════════════════════════════════════════════
  let y = 90;
  doc.setDrawColor(20);
  doc.setLineWidth(1.5);
  doc.rect(margin - 10, 60, pw - (margin - 10) * 2, 120);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(0);
  doc.text('Combined HVAC Design Report', pw / 2, y, { align: 'center' }); y += 28;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(80);
  doc.text(projectName, pw / 2, y, { align: 'center' }); y += 20;
  doc.setFontSize(10); doc.setTextColor(110);
  doc.text(`ACCA Manual J / S / D  ·  ${dateStr}`, pw / 2, y, { align: 'center' });
  y = 210;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
  doc.text('Included Sections', margin, y); y += 20;
  doc.setFontSize(10);
  if (included.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setTextColor(150);
    doc.text('No calculator data available for this project.', margin, y); y += 16;
    doc.setTextColor(0);
  } else {
    included.forEach((s, i) => {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
      doc.text(`${i + 1}.`, margin, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
      doc.text(s.label, margin + 24, y);
      y += 16;
    });
  }

  drawFooter('Combined Report — ACCA Manual J / S / D');
  drawStamp();

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: MANUAL J
  // ════════════════════════════════════════════════════════════════════════
  if (data.manualJ) {
    const mj = data.manualJ;
    doc.addPage();
    y = 56;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
    doc.text('Manual J — Load Calculation', margin, y); y += 10;
    doc.setDrawColor(180); doc.setLineWidth(0.75); doc.line(margin, y, pw - margin, y); y += 22;

    y = pairBlock(y, 'Whole-House Loads', [
      ['Total heating', `${fmt(mj.totalHeatingBtu)} BTU/h`],
      ['Total cooling', `${fmt(mj.totalCoolingBtu)} BTU/h`],
      ['Sensible cooling', `${fmt(mj.totalCoolingSensible)} BTU/h`],
      ['Latent cooling', `${fmt(mj.totalCoolingLatent)} BTU/h`],
      ['Recommended size', `${mj.recommendedTons.toFixed(1)} tons`],
      ['Sensible heat ratio', mj.sensibleHeatRatio.toFixed(3)],
      ['Ventilation airflow', `${fmt(mj.ventilationCFM)} CFM`],
    ]);

    // Per-room breakdown table.
    if (Array.isArray(mj.rooms) && mj.rooms.length > 0) {
      if (y > ph - 90) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
      doc.text('Per-Room Loads', margin, y); y += 16;

      const c = { room: margin, heat: margin + 280, sens: margin + 380, lat: margin + 460, tot: pw - margin };
      const header = (): void => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
        doc.text('Room', c.room, y);
        doc.text('Heating', c.heat, y, { align: 'right' });
        doc.text('Cool Sens', c.sens, y, { align: 'right' });
        doc.text('Cool Lat', c.lat, y, { align: 'right' });
        doc.text('Cool Total', c.tot, y, { align: 'right' });
        y += 4; doc.setDrawColor(180); doc.line(margin, y, pw - margin, y); y += 12;
      };
      header();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      for (const r of mj.rooms) {
        if (y > ph - 50) { doc.addPage(); y = 56; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
        doc.setTextColor(0);
        doc.text((r.roomName || 'Room').slice(0, 48), c.room, y);
        doc.text(fmt(r.heatingBtu), c.heat, y, { align: 'right' });
        doc.text(fmt(r.coolingBtuSensible), c.sens, y, { align: 'right' });
        doc.text(fmt(r.coolingBtuLatent), c.lat, y, { align: 'right' });
        doc.text(fmt(r.coolingBtuTotal), c.tot, y, { align: 'right' });
        y += 14;
      }
      // Totals row
      if (y > ph - 50) { doc.addPage(); y = 56; }
      y += 2; doc.setDrawColor(180); doc.line(margin, y, pw - margin, y); y += 12;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
      doc.text('TOTAL', c.room, y);
      doc.text(fmt(mj.totalHeatingBtu), c.heat, y, { align: 'right' });
      doc.text(fmt(mj.totalCoolingSensible), c.sens, y, { align: 'right' });
      doc.text(fmt(mj.totalCoolingLatent), c.lat, y, { align: 'right' });
      doc.text(fmt(mj.totalCoolingBtu), c.tot, y, { align: 'right' });
    }

    drawFooter('Manual J — ACCA Manual J 8th Edition');
    drawStamp();
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: AED
  // ════════════════════════════════════════════════════════════════════════
  if (data.aed) {
    const aed = data.aed;
    doc.addPage();
    y = 56;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
    doc.text('AED — Adequate Exposure Diversity', margin, y); y += 10;
    doc.setDrawColor(180); doc.setLineWidth(0.75); doc.line(margin, y, pw - margin, y); y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    if (aed.pass) { doc.setTextColor(16, 150, 100); doc.text('PASS — exposure diversity within limits', margin, y); }
    else { doc.setTextColor(200, 60, 60); doc.text('FAIL — peak glass load exceeds the 30% AED threshold', margin, y); }
    y += 20;

    const pairs: [string, string][] = [
      ['Peak hourly glass load', `${fmt(aed.peakLoad)} BTU/h`],
      ['Peak hour', String(aed.peakHour)],
      ['12-hour average', `${fmt(aed.averageLoad)} BTU/h`],
      ['Peak / average ratio', aed.ratio.toFixed(3)],
    ];
    if (aed.excursion > 0) pairs.push(['Excursion penalty', `+${fmt(aed.excursion)} BTU/h to cooling load`]);
    y = pairBlock(y, 'AED Summary (Manual J Section N)', pairs);

    // Hourly table
    if (Array.isArray(aed.hourlyLoads) && aed.hourlyLoads.length > 0) {
      if (y > ph - 90) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
      doc.text('Hourly Glass Load', margin, y); y += 16;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text('Hour', margin, y);
      doc.text('Total Glass Load (BTU/h)', pw - margin, y, { align: 'right' });
      y += 4; doc.setDrawColor(180); doc.line(margin, y, pw - margin, y); y += 12;
      for (const h of aed.hourlyLoads) {
        if (y > ph - 50) { doc.addPage(); y = 56; }
        const isPeak = h.hour === aed.peakHour;
        doc.setFont('helvetica', isPeak ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(0);
        doc.text(h.label, margin, y);
        doc.text(fmt(h.totalGlassLoad) + (isPeak ? '  (peak)' : ''), pw - margin, y, { align: 'right' });
        y += 13;
      }
    }

    drawFooter('AED — ACCA Manual J Section N');
    drawStamp();
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: MANUAL S
  // ════════════════════════════════════════════════════════════════════════
  if (data.manualS) {
    const ms = data.manualS;
    doc.addPage();
    y = 56;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
    doc.text('Manual S — Equipment Selection', margin, y); y += 10;
    doc.setDrawColor(180); doc.setLineWidth(0.75); doc.line(margin, y, pw - margin, y); y += 22;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    if (ms.overallPass) { doc.setTextColor(16, 150, 100); doc.text('PASS — selection within Manual S limits', margin, y); }
    else { doc.setTextColor(200, 60, 60); doc.text('REVIEW — selection outside Manual S limits', margin, y); }
    y += 20;

    const c = ms.cooling;
    const h = ms.heating;

    const coolPairs: [string, string][] = [
      ['Total capacity @ design', `${fmt(c.totalCapacityBtu)} BTU/h  (${c.totalSizingPct}%)`],
      ['Sensible capacity @ design', `${fmt(c.sensibleCapacityBtu)} BTU/h  (${c.sensibleSizingPct}%)`],
      ['Latent capacity', `${fmt(c.latentCapacityBtu)} BTU/h  (${c.latentSizingPct}%)`],
      ['Equipment / load SHR', `${c.equipmentShr} / ${c.loadShr}`],
    ];
    if (c.altitudeCorrectionApplied) coolPairs.push(['Altitude derate', `−${c.altitudeDeratePct}% sensible`]);
    y = pairBlock(y, `Cooling Equipment — ${coolingStatusLabel(c.status)}`, coolPairs);

    if (h.status !== 'no_equipment') {
      const heatPairs: [string, string][] = [
        ['Capacity', `${fmt(h.capacityBtu)} BTU/h${h.sizingPct > 0 ? `  (${h.sizingPct}%)` : ''}`],
      ];
      if (h.supplementalHeatBtu > 0) heatPairs.push(['Supplemental heat', `${fmt(h.supplementalHeatBtu)} BTU/h (${h.supplementalHeatKw} kW)`]);
      if (h.balancePointF != null) heatPairs.push(['Balance point', `${h.balancePointF}°F`]);
      y = pairBlock(y, `Heating Equipment — ${heatingStatusLabel(h.status)}`, heatPairs);
    }

    const allWarnings = [...c.warnings, ...h.warnings];
    if (allWarnings.length > 0) {
      if (y > ph - 60) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
      doc.text('Warnings', margin, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60);
      for (const w of allWarnings) {
        if (y > ph - 50) { doc.addPage(); y = 56; }
        const lines = doc.splitTextToSize(`•  ${w}`, pw - margin * 2) as string[];
        doc.text(lines, margin, y); y += lines.length * 11;
      }
      doc.setTextColor(0);
    }

    drawFooter(`Manual S ${ms.engineVersion}  —  ACCA Manual S (Equipment Selection)`);
    drawStamp();
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: MANUAL D
  // ════════════════════════════════════════════════════════════════════════
  if (data.manualD) {
    const md = data.manualD;
    doc.addPage();
    y = 56;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0);
    doc.text('Manual D — Duct Design & Sizing', margin, y); y += 10;
    doc.setDrawColor(180); doc.setLineWidth(0.75); doc.line(margin, y, pw - margin, y); y += 22;

    y = pairBlock(y, 'System Summary', [
      ['Total system airflow', `${fmt(md.totalSystemCfm)} CFM`],
      ['Available static pressure', `${md.availableSpInwg} inwg`],
      ['Design friction rate', `${md.designFrictionRate.toFixed(4)} inwg/100ft`],
      ['Critical path length', `${md.criticalPathLength} ft TEL`],
      ['Critical path pressure drop', `${md.criticalPathPressureDrop.toFixed(4)} inwg`],
      ['System balance', md.isBalanced ? 'Balanced' : 'Needs balancing'],
    ]);

    // Duct schedule table
    if (Array.isArray(md.runs) && md.runs.length > 0) {
      if (y > ph - 90) { doc.addPage(); y = 56; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
      doc.text('Duct Schedule', margin, y); y += 16;

      const c = { room: margin, cfm: margin + 250, tel: margin + 330, size: margin + 400, vel: margin + 520, pd: pw - margin };
      const header = (): void => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
        doc.text('Room', c.room, y);
        doc.text('CFM', c.cfm, y, { align: 'right' });
        doc.text('TEL (ft)', c.tel, y, { align: 'right' });
        doc.text('Duct Size', c.size, y);
        doc.text('Velocity', c.vel, y, { align: 'right' });
        doc.text('Drop (inwg)', c.pd, y, { align: 'right' });
        y += 4; doc.setDrawColor(180); doc.line(margin, y, pw - margin, y); y += 12;
      };
      header();
      for (const run of md.runs) {
        if (y > ph - 50) { doc.addPage(); y = 56; header(); }
        const isCp = run.isCriticalPath;
        doc.setFont('helvetica', isCp ? 'bold' : 'normal'); doc.setFontSize(9);
        doc.setTextColor(isCp ? 180 : 0, isCp ? 110 : 0, isCp ? 20 : 0);
        const sizeStr = run.diameterIn != null
          ? `${run.diameterIn}" rd`
          : (run.widthIn != null && run.heightIn != null)
            ? `${run.widthIn}x${run.heightIn}"`
            : `${run.equivalentDiameterIn}" eq`;
        doc.text((run.roomName || 'Room').slice(0, 36) + (isCp ? '  (CP)' : ''), c.room, y);
        doc.text(String(run.requiredCfm), c.cfm, y, { align: 'right' });
        doc.text(String(run.totalEquivLengthFt), c.tel, y, { align: 'right' });
        doc.text(sizeStr, c.size, y);
        doc.text(`${run.velocityFpm} fpm`, c.vel, y, { align: 'right' });
        doc.text(run.pressureDropInwg.toFixed(4), c.pd, y, { align: 'right' });
        y += 14;
      }
      doc.setTextColor(0);
    }

    // Balancing notes
    if (Array.isArray(md.balancingNotes) && md.balancingNotes.length > 0) {
      if (y > ph - 70) { doc.addPage(); y = 56; }
      y += 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
      doc.text('Balancing Notes', margin, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60);
      for (const note of md.balancingNotes) {
        if (y > ph - 50) { doc.addPage(); y = 56; }
        const lines = doc.splitTextToSize(`•  ${note}`, pw - margin * 2) as string[];
        doc.text(lines, margin, y); y += lines.length * 11;
      }
      doc.setTextColor(0);
    }

    drawFooter('Manual D manualD-1.0  —  ACCA Manual D (Equal Friction Method)');
    drawStamp();
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const safeName = projectName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Report';
  doc.save(`CombinedReport_${safeName}_${dateStr}.pdf`);
}
