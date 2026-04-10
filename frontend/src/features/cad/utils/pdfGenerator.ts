import { jsPDF } from 'jspdf';
import * as fabric from 'fabric';
import { usePreferencesStore } from '../../../stores/usePreferencesStore';

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface ProjectMetadata {
  projectName: string;
  engineerName: string;
  organisationName: string;
  date: string;
  region: string;
  projectId: string;
}

interface FloorData {
  name: string;
  heightFt: number;
  walls: {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    thicknessIn: number;
    rValue: number;
    material: string;
  }[];
  openings: {
    id: string;
    type: string;
    wallId: string;
    widthIn: number;
    heightIn: number;
    uFactor?: number;
    shgc?: number;
    glassType?: string;
    swingDirection?: string;
  }[];
  hvacUnits: {
    id: string;
    type: string;
    cfm?: number;
    label?: string;
  }[];
  rooms: {
    name: string;
    areaSqFt: number;
    perimeterFt: number;
  }[];
  annotations: {
    type: string;
    text: string;
  }[];
}

interface ManualJSummary {
  totalHeatingBtu: number;
  totalCoolingBtu: number;
  tonnage: number;
  designConditions: {
    outdoorHeating: number;
    outdoorCooling: number;
    indoorHeating: number;
    indoorCooling: number;
    constructionQuality: string;
    dailyRange: string;
  };
  rooms?: {
    name: string;
    heatingBtu: number;
    coolingBtu: number;
  }[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

let PAGE_W = 297;
let PAGE_H = 210;
const MARGIN = 5;
const PX_PER_FT = 40;

const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_50: [number, number, number] = [248, 250, 252];
const EMERALD_500: [number, number, number] = [16, 185, 129];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
const GRAY_400: [number, number, number] = [156, 163, 175];

// ── Table Helper ───────────────────────────────────────────────────────────────

function drawTable(
  doc: jsPDF,
  x: number,
  y: number,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): number {
  const cellPad = 2;
  const headerH = 6;
  const rowH = 5;

  // Header row
  let cx = x;
  doc.setFillColor(...SLATE_900);
  doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), headerH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx + cellPad, y + headerH - 1.5, { maxWidth: colWidths[i] - cellPad * 2 });
    cx += colWidths[i];
  }

  let curY = y + headerH;

  // Data rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (let r = 0; r < rows.length; r++) {
    const isAlt = r % 2 === 1;
    if (isAlt) {
      doc.setFillColor(...SLATE_50);
      doc.rect(x, curY, colWidths.reduce((a, b) => a + b, 0), rowH, 'F');
    }
    doc.setTextColor(...BLACK);
    cx = x;
    for (let c = 0; c < rows[r].length; c++) {
      doc.text(String(rows[r][c] ?? ''), cx + cellPad, curY + rowH - 1.2, {
        maxWidth: colWidths[c] - cellPad * 2,
      });
      cx += colWidths[c];
    }
    curY += rowH;
  }

  // Table border
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.2);
  doc.rect(x, y, totalW, curY - y);

  // Column lines
  cx = x;
  for (let i = 0; i < colWidths.length - 1; i++) {
    cx += colWidths[i];
    doc.line(cx, y, cx, curY);
  }

  // Header separator
  doc.line(x, y + headerH, x + totalW, y + headerH);

  return curY;
}

// ── Shared Page Chrome ─────────────────────────────────────────────────────────

function drawPageBorder(doc: jsPDF): void {
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, MARGIN, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);
}

function drawCompactTitleBlock(
  doc: jsPDF,
  metadata: ProjectMetadata,
  pageNum: number,
): void {
  const tbW = 80;
  const tbH = 20;
  const tbX = PAGE_W - MARGIN - tbW;
  const tbY = PAGE_H - MARGIN - tbH;

  doc.setFillColor(...SLATE_50);
  doc.rect(tbX, tbY, tbW, tbH, 'F');
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.2);
  doc.rect(tbX, tbY, tbW, tbH);

  // Vertical divider
  doc.line(tbX + 55, tbY, tbX + 55, tbY + tbH);
  // Horizontal divider
  doc.line(tbX, tbY + 10, tbX + tbW, tbY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BLACK);
  doc.text(metadata.projectName || 'UNNAMED', tbX + 2, tbY + 4, { maxWidth: 51 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(metadata.projectId, tbX + 2, tbY + 8);

  doc.text(metadata.date, tbX + 2, tbY + 15);

  // Sheet number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`M-${pageNum}01`, tbX + 57, tbY + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(`PG ${pageNum}`, tbX + 57, tbY + 15);
}

function drawWatermark(doc: jsPDF, pageW: number, pageH: number): void {
  const prefs = usePreferencesStore.getState();
  const watermarkText = prefs.pdfWatermarkText || 'GENERATED BY HVAC DESIGNPRO';
  doc.setFontSize(5.5);
  doc.setTextColor(...GRAY_400);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${watermarkText} \u2014 CLOUD ENGINEERING ENGINE`,
    MARGIN + 2,
    pageH - MARGIN - 2,
  );
}

function drawPageChrome(
  doc: jsPDF,
  metadata: ProjectMetadata,
  pageNum: number,
): void {
  drawPageBorder(doc);
  drawCompactTitleBlock(doc, metadata, pageNum);
  drawWatermark(doc, PAGE_W, PAGE_H);
}

function drawPageTitle(doc: jsPDF, title: string): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...SLATE_900);
  doc.text(title, MARGIN + 5, MARGIN + 12);
  doc.setLineWidth(0.3);
  doc.setDrawColor(...SLATE_900);
  doc.line(MARGIN + 5, MARGIN + 14, PAGE_W - MARGIN - 5, MARGIN + 14);
}

// ── Page 1: Cover / Drawing Plot ───────────────────────────────────────────────

function drawCoverPage(
  doc: jsPDF,
  canvasDataUrl: string,
  metadata: ProjectMetadata,
): void {
  drawPageBorder(doc);
  drawWatermark(doc, PAGE_W, PAGE_H);

  // Canvas image — fit within drawing area leaving room for title block
  const drawW = PAGE_W - 20;
  const drawH = PAGE_H - 60;
  doc.addImage(canvasDataUrl, 'PNG', 10, 10, drawW, drawH);

  // Scale indicator
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GRAY_400);
  doc.text('SCALE: REFERENCE ONLY', PAGE_W / 2, PAGE_H - 50, { align: 'center' });

  // North arrow (top-right of drawing area)
  const naX = PAGE_W - 25;
  const naY = 18;
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.4);
  // Vertical line
  doc.line(naX, naY + 12, naX, naY);
  // Arrow head
  doc.line(naX, naY, naX - 3, naY + 5);
  doc.line(naX, naY, naX + 3, naY + 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('N', naX, naY - 2, { align: 'center' });

  // Full title block (115x40mm for cover page)
  const tbX = PAGE_W - 120;
  const tbY = PAGE_H - 45;
  const tbW = 115;
  const tbH = 40;

  doc.setFillColor(...SLATE_50);
  doc.rect(tbX, tbY, tbW, tbH, 'F');
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.3);
  doc.rect(tbX, tbY, tbW, tbH);

  // Internal grid
  doc.line(tbX + 50, tbY, tbX + 50, tbY + tbH);
  doc.line(tbX, tbY + 15, tbX + tbW, tbY + 15);

  // Firm name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  doc.text('ENGINEERING FIRM / ORG', tbX + 2, tbY + 5);
  doc.setFontSize(14);
  doc.setTextColor(...EMERALD_500);
  doc.text(metadata.organisationName.toUpperCase(), tbX + 2, tbY + 12);

  // Project info
  doc.setTextColor(...BLACK);
  doc.setFontSize(8);
  doc.text('PROJECT NAME', tbX + 52, tbY + 5);
  doc.setFontSize(10);
  doc.text(metadata.projectName || 'UNNAMED_SCHEMA', tbX + 52, tbY + 10, { maxWidth: 60 });

  // Metadata grid
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('ENGINEER OF RECORD', tbX + 2, tbY + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(metadata.engineerName, tbX + 2, tbY + 25);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('DATE', tbX + 52, tbY + 20);
  doc.setFont('helvetica', 'normal');
  doc.text(metadata.date, tbX + 52, tbY + 25);

  doc.setFont('helvetica', 'bold');
  doc.text('REGION', tbX + 80, tbY + 20);
  doc.setFont('helvetica', 'normal');
  doc.text(metadata.region, tbX + 80, tbY + 25);

  doc.setFont('helvetica', 'bold');
  doc.text('PROJECT ID', tbX + 2, tbY + 32);
  doc.setFont('helvetica', 'normal');
  doc.text(metadata.projectId, tbX + 2, tbY + 37);

  doc.setFont('helvetica', 'bold');
  doc.text('SHEET NO.', tbX + 95, tbY + 32);
  doc.setFontSize(12);
  doc.text('M-101', tbX + 95, tbY + 38);

  // Revision block (below title block)
  const revY = tbY + tbH + 1;
  doc.setLineWidth(0.2);
  doc.setDrawColor(...SLATE_900);
  doc.rect(tbX, revY, tbW, 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...BLACK);
  doc.text(`REV 0 \u2014 INITIAL ISSUE \u2014 ${metadata.date}`, tbX + 2, revY + 4);

  // PE Seal / Firm Stamp
  const prefs = usePreferencesStore.getState();
  const sealX = tbX - 18;
  const sealY = tbY + tbH / 2;
  const sealR = 12.5;

  if (prefs.firmStampDataUrl) {
    // Render the actual uploaded stamp image
    try {
      doc.addImage(prefs.firmStampDataUrl, 'PNG', sealX - sealR, sealY - sealR, sealR * 2, sealR * 2);
    } catch {
      // Fallback to placeholder if image fails
      drawSealPlaceholder(doc, sealX, sealY, sealR, 'PE SEAL');
    }
  } else {
    drawSealPlaceholder(doc, sealX, sealY, sealR, 'PE SEAL');
  }

  // Notary Stamp (below the PE seal, if uploaded)
  if (prefs.notaryStampDataUrl) {
    const notaryY = sealY + sealR + 8;
    try {
      doc.addImage(prefs.notaryStampDataUrl, 'PNG', sealX - sealR, notaryY - sealR, sealR * 2, sealR * 2);
    } catch {
      drawSealPlaceholder(doc, sealX, notaryY, sealR * 0.8, 'NOTARY');
    }
  }
}

function drawSealPlaceholder(doc: jsPDF, cx: number, cy: number, r: number, label: string): void {
  doc.setDrawColor(...GRAY_400);
  doc.setLineWidth(0.3);
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    if (i % 2 === 0) {
      const a1 = (i / segments) * 2 * Math.PI;
      const a2 = ((i + 1) / segments) * 2 * Math.PI;
      doc.line(
        cx + r * Math.cos(a1), cy + r * Math.sin(a1),
        cx + r * Math.cos(a2), cy + r * Math.sin(a2),
      );
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY_400);
  doc.text(label, cx, cy + 1, { align: 'center' });
}

// ── Page 2: Room & Wall Schedules ──────────────────────────────────────────────

function drawSchedulesRoomWall(
  doc: jsPDF,
  metadata: ProjectMetadata,
  floors: FloorData[],
): void {
  drawPageChrome(doc, metadata, 2);
  drawPageTitle(doc, 'SCHEDULES \u2014 ROOM & WALL');

  let curY = MARGIN + 20;

  // Room Schedule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('ROOM SCHEDULE', MARGIN + 5, curY);
  curY += 3;

  const roomHeaders = ['#', 'Room Name', 'Area (sq ft)', 'Perimeter (ft)', 'Floor', 'Ceiling Ht (ft)'];
  const roomColWidths = [10, 60, 35, 35, 50, 35];
  const roomRows: string[][] = [];
  let roomIdx = 1;
  for (const floor of floors) {
    for (const room of floor.rooms) {
      roomRows.push([
        String(roomIdx++),
        room.name,
        room.areaSqFt.toFixed(1),
        room.perimeterFt.toFixed(1),
        floor.name,
        floor.heightFt.toFixed(1),
      ]);
    }
  }

  if (roomRows.length > 0) {
    curY = drawTable(doc, MARGIN + 5, curY, roomHeaders, roomRows, roomColWidths);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_400);
    doc.text('No rooms detected.', MARGIN + 5, curY + 5);
    curY += 10;
  }

  curY += 8;

  // Wall Schedule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('WALL SCHEDULE', MARGIN + 5, curY);
  curY += 3;

  const wallHeaders = ['#', 'Wall ID', 'Length (ft)', 'Thickness (in)', 'R-Value', 'Material', 'Floor'];
  const wallColWidths = [10, 40, 30, 35, 25, 50, 40];
  const wallRows: string[][] = [];
  let wallIdx = 1;
  for (const floor of floors) {
    for (const wall of floor.walls) {
      const lengthPx = Math.sqrt(
        Math.pow(wall.x2 - wall.x1, 2) + Math.pow(wall.y2 - wall.y1, 2),
      );
      const lengthFt = lengthPx / PX_PER_FT;
      wallRows.push([
        String(wallIdx++),
        wall.id,
        lengthFt.toFixed(1),
        wall.thicknessIn.toFixed(1),
        wall.rValue.toFixed(1),
        wall.material,
        floor.name,
      ]);
    }
  }

  if (wallRows.length > 0) {
    curY = drawTable(doc, MARGIN + 5, curY, wallHeaders, wallRows, wallColWidths);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_400);
    doc.text('No walls defined.', MARGIN + 5, curY + 5);
  }
}

// ── Page 3: Opening & HVAC Schedules ───────────────────────────────────────────

function drawSchedulesOpeningHvac(
  doc: jsPDF,
  metadata: ProjectMetadata,
  floors: FloorData[],
): void {
  drawPageChrome(doc, metadata, 3);
  drawPageTitle(doc, 'SCHEDULES \u2014 OPENINGS & EQUIPMENT');

  let curY = MARGIN + 20;

  // Opening Schedule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('OPENING SCHEDULE', MARGIN + 5, curY);
  curY += 3;

  const openHeaders = ['#', 'Type', 'Size (W\u00d7H)', 'U-Factor', 'SHGC', 'Glass Type', 'Swing', 'Floor'];
  const openColWidths = [10, 30, 30, 25, 20, 45, 30, 40];
  const openRows: string[][] = [];
  let openIdx = 1;
  for (const floor of floors) {
    for (const op of floor.openings) {
      openRows.push([
        String(openIdx++),
        op.type,
        `${op.widthIn}\u2033\u00d7${op.heightIn}\u2033`,
        op.uFactor != null ? op.uFactor.toFixed(2) : '\u2014',
        op.shgc != null ? op.shgc.toFixed(2) : '\u2014',
        op.glassType ?? '\u2014',
        op.swingDirection ?? '\u2014',
        floor.name,
      ]);
    }
  }

  if (openRows.length > 0) {
    curY = drawTable(doc, MARGIN + 5, curY, openHeaders, openRows, openColWidths);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_400);
    doc.text('No openings defined.', MARGIN + 5, curY + 5);
    curY += 10;
  }

  curY += 8;

  // HVAC Equipment Schedule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('HVAC EQUIPMENT SCHEDULE', MARGIN + 5, curY);
  curY += 3;

  const hvacHeaders = ['#', 'Type', 'Label', 'CFM', 'Floor'];
  const hvacColWidths = [10, 60, 60, 40, 60];
  const hvacRows: string[][] = [];
  let hvacIdx = 1;
  let totalSupplyCfm = 0;
  let totalReturnCfm = 0;
  for (const floor of floors) {
    for (const unit of floor.hvacUnits) {
      hvacRows.push([
        String(hvacIdx++),
        unit.type,
        unit.label ?? '\u2014',
        unit.cfm != null ? String(unit.cfm) : '\u2014',
        floor.name,
      ]);
      if (unit.cfm != null) {
        if (unit.type === 'supply_register') totalSupplyCfm += unit.cfm;
        if (unit.type === 'return_grille') totalReturnCfm += unit.cfm;
      }
    }
  }

  if (hvacRows.length > 0) {
    // Summary row
    hvacRows.push(['', '', 'TOTAL SUPPLY CFM', String(totalSupplyCfm), '']);
    hvacRows.push(['', '', 'TOTAL RETURN CFM', String(totalReturnCfm), '']);
    curY = drawTable(doc, MARGIN + 5, curY, hvacHeaders, hvacRows, hvacColWidths);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_400);
    doc.text('No HVAC equipment placed.', MARGIN + 5, curY + 5);
  }
}

// ── Page 4: Manual J Load Summary ──────────────────────────────────────────────

function drawLoadSummary(
  doc: jsPDF,
  metadata: ProjectMetadata,
  manualJ: ManualJSummary,
): void {
  drawPageChrome(doc, metadata, 4);
  drawPageTitle(doc, 'MANUAL J LOAD SUMMARY');

  let curY = MARGIN + 22;

  // Design Conditions box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('DESIGN CONDITIONS', MARGIN + 5, curY);
  curY += 2;

  const dcBoxW = 130;
  const dcBoxH = 30;
  doc.setDrawColor(...SLATE_900);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN + 5, curY, dcBoxW, dcBoxH);
  doc.setFillColor(...SLATE_50);
  doc.rect(MARGIN + 5, curY, dcBoxW, dcBoxH, 'F');
  doc.rect(MARGIN + 5, curY, dcBoxW, dcBoxH);

  const dc = manualJ.designConditions;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...BLACK);
  const dcX = MARGIN + 8;
  doc.text(`Outdoor Heating: ${dc.outdoorHeating}\u00b0F`, dcX, curY + 6);
  doc.text(`Outdoor Cooling: ${dc.outdoorCooling}\u00b0F`, dcX, curY + 11);
  doc.text(`Indoor Heating: ${dc.indoorHeating}\u00b0F`, dcX + 55, curY + 6);
  doc.text(`Indoor Cooling: ${dc.indoorCooling}\u00b0F`, dcX + 55, curY + 11);
  doc.text(`Construction Quality: ${dc.constructionQuality}`, dcX, curY + 18);
  doc.text(`Daily Range: ${dc.dailyRange}`, dcX, curY + 23);
  curY += dcBoxH + 6;

  // Summary box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('LOAD SUMMARY', MARGIN + 5, curY);
  curY += 2;

  const sumBoxW = 130;
  const sumBoxH = 22;
  doc.setFillColor(...SLATE_50);
  doc.rect(MARGIN + 5, curY, sumBoxW, sumBoxH, 'F');
  doc.setDrawColor(...SLATE_900);
  doc.rect(MARGIN + 5, curY, sumBoxW, sumBoxH);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.text(
    `Total Heating: ${manualJ.totalHeatingBtu.toLocaleString()} BTU/hr`,
    MARGIN + 8,
    curY + 7,
  );
  doc.text(
    `Total Cooling: ${manualJ.totalCoolingBtu.toLocaleString()} BTU/hr`,
    MARGIN + 8,
    curY + 13,
  );
  doc.setFont('helvetica', 'bold');
  doc.text(`Tonnage: ${manualJ.tonnage.toFixed(1)} tons`, MARGIN + 8, curY + 19);
  curY += sumBoxH + 6;

  // Per-room breakdown
  if (manualJ.rooms && manualJ.rooms.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_900);
    doc.text('PER-ROOM BREAKDOWN', MARGIN + 5, curY);
    curY += 3;

    const rmHeaders = ['Room', 'Heating (BTU/hr)', 'Cooling (BTU/hr)'];
    const rmColWidths = [80, 60, 60];
    const rmRows: string[][] = manualJ.rooms.map((r) => [
      r.name,
      r.heatingBtu.toLocaleString(),
      r.coolingBtu.toLocaleString(),
    ]);
    curY = drawTable(doc, MARGIN + 5, curY, rmHeaders, rmRows, rmColWidths);
  }

  // Disclaimer
  curY += 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(...GRAY_400);
  doc.text(
    'Equipment sizing per ACCA Manual J 8th Edition. Verify with licensed engineer.',
    MARGIN + 5,
    curY,
  );
}

// ── Page 5: Notes & Disclaimers ────────────────────────────────────────────────

function drawNotesPage(doc: jsPDF, metadata: ProjectMetadata, pageNum: number): void {
  drawPageChrome(doc, metadata, pageNum);
  drawPageTitle(doc, 'GENERAL NOTES');

  let curY = MARGIN + 22;

  const notes = [
    'All dimensions are to finished surfaces unless noted otherwise.',
    'R-values represent total assembly thermal resistance.',
    'HVAC equipment CFM ratings are nominal. Verify with manufacturer data.',
    'This document is generated by HVAC DesignPro and is intended as a preliminary engineering reference.',
    'Final equipment selection and installation shall comply with all applicable codes and manufacturer specifications.',
    'Contractor shall verify all dimensions and conditions in the field prior to construction.',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  for (let i = 0; i < notes.length; i++) {
    doc.text(`${i + 1}.  ${notes[i]}`, MARGIN + 8, curY, { maxWidth: PAGE_W - MARGIN * 2 - 20 });
    curY += 7;
  }

  curY += 6;

  // Codes & Standards
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_900);
  doc.text('CODES & STANDARDS REFERENCE', MARGIN + 5, curY);
  curY += 5;

  const codes = [
    'ASHRAE Standard 90.1 \u2014 Energy Standard for Buildings',
    'ACCA Manual J \u2014 Residential Load Calculation',
    'ACCA Manual D \u2014 Residential Duct Systems',
    'ACCA Manual S \u2014 Residential Equipment Selection',
    'International Residential Code (IRC)',
    'International Mechanical Code (IMC)',
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...BLACK);
  for (const code of codes) {
    doc.text(`\u2022  ${code}`, MARGIN + 8, curY);
    curY += 5;
  }

  // Large rotated watermark across page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(36);
  doc.setTextColor(220, 220, 220);
  doc.saveGraphicsState();
  const cx = PAGE_W / 2;
  const cy = PAGE_H / 2;
  const textW = doc.getTextWidth('PREPARED FOR PERMIT REVIEW \u2014 NOT FOR CONSTRUCTION');

  // Use text with rotation angle (jsPDF supports angle parameter)
  doc.text(
    'PREPARED FOR PERMIT REVIEW \u2014 NOT FOR CONSTRUCTION',
    cx - textW / 2 + 20,
    cy + 10,
    { angle: 30 },
  );
  doc.restoreGraphicsState();
}

// ── Main Export Function ───────────────────────────────────────────────────────

export const generatePdfPlot = (
  canvas: fabric.Canvas,
  metadata: ProjectMetadata,
  floors: FloorData[],
  manualJ?: ManualJSummary | null,
): void => {
  const prefs = usePreferencesStore.getState();

  // Resolve page format from preferences
  const formatMap: Record<string, string> = { letter: 'letter', a4: 'a4', tabloid: 'tabloid' };
  const jsPdfFormat = formatMap[prefs.pdfPageSize] || 'a4';
  const orientation = prefs.pdfOrientation === 'portrait' ? 'portrait' as const : 'landscape' as const;

  const doc = new jsPDF({ orientation, unit: 'mm', format: jsPdfFormat });

  // Update dynamic page dimensions
  PAGE_W = doc.internal.pageSize.getWidth();
  PAGE_H = doc.internal.pageSize.getHeight();

  // Capture canvas at 2x
  const canvasDataUrl = canvas.toDataURL({
    format: 'png',
    quality: 1,
    multiplier: 2,
    enableRetinaScaling: true,
  });

  let pageNum = 1;

  // Page 1: Cover / Drawing Plot (always included)
  if (prefs.pdfIncludeDrawing) {
    drawCoverPage(doc, canvasDataUrl, metadata);
  } else {
    // Minimal cover with title block only (no drawing)
    drawPageBorder(doc);
    drawWatermark(doc, PAGE_W, PAGE_H);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...SLATE_900);
    doc.text(metadata.projectName || 'HVAC DESIGNPRO', PAGE_W / 2, PAGE_H / 2, { align: 'center' });
  }

  // Page 2: Room & Wall Schedules
  if (prefs.pdfIncludeRoomSchedule) {
    doc.addPage(jsPdfFormat, orientation);
    pageNum++;
    drawSchedulesRoomWall(doc, metadata, floors);
  }

  // Page 3: Opening & HVAC Schedules
  if (prefs.pdfIncludeOpeningSchedule) {
    doc.addPage(jsPdfFormat, orientation);
    pageNum++;
    drawSchedulesOpeningHvac(doc, metadata, floors);
  }

  // Page 4: Load Summary (conditional on data AND preference)
  if (manualJ && prefs.pdfIncludeLoadSummary) {
    doc.addPage(jsPdfFormat, orientation);
    pageNum++;
    drawLoadSummary(doc, metadata, manualJ);
  }

  // Notes & Disclaimers
  if (prefs.pdfIncludeNotes) {
    doc.addPage(jsPdfFormat, orientation);
    pageNum++;
    drawNotesPage(doc, metadata, pageNum);
  }

  // Add positioned stamps on all pages if configured
  const stampUrl = prefs.firmStampDataUrl;
  const stampPos = prefs.firmStampPosition;
  if (stampUrl && stampPos !== 'bottom-right') {
    // Cover page already has stamp near title block (bottom-right default)
    // For other positions, overlay on every page
    const totalPages = doc.getNumberOfPages();
    const stampSize = 25; // mm
    const posMap: Record<string, [number, number]> = {
      'top-left': [MARGIN + 2, MARGIN + 2],
      'top-right': [PAGE_W - MARGIN - stampSize - 2, MARGIN + 2],
      'bottom-left': [MARGIN + 2, PAGE_H - MARGIN - stampSize - 2],
      'bottom-right': [PAGE_W - MARGIN - stampSize - 2, PAGE_H - MARGIN - stampSize - 2],
    };
    const [sx, sy] = posMap[stampPos] || posMap['bottom-right'];
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      try { doc.addImage(stampUrl, 'PNG', sx, sy, stampSize, stampSize); } catch { /* skip */ }
    }
  }

  // Save
  doc.save(`HVAC_PLOT_${metadata.projectId}_${metadata.date.replace(/\//g, '-')}.pdf`);
};
