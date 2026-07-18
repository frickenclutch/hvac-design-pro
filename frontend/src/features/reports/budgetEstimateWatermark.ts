/**
 * Un-removable BUDGET ESTIMATE watermark (Unit N0, decision D3).
 *
 * Any PDF whose numbers are budget-estimate grade (today: commercial projects
 * run through the residential engines) gets a diagonal stamp on EVERY page.
 * This deliberately does NOT read the `pdfWatermarkText` preference and has no
 * off switch — the one ratified exception to the "every preference persists"
 * personalization philosophy: liability beats personalization exactly once.
 * The preference-driven footer watermark continues to render independently.
 *
 * Drawing idiom mirrors the proven CAD pdfGenerator rotated-watermark
 * (features/cad/utils/pdfGenerator.ts drawPermitWatermark): bold rotated
 * text via jsPDF's `angle` option, light color so content stays legible.
 * Type-only jsPDF import — callers lazy-load jsPDF; this adds zero bundle.
 */

import type { jsPDF } from 'jspdf';

export const BUDGET_ESTIMATE_WATERMARK = 'BUDGET ESTIMATE — NOT FOR PERMIT SUBMISSION';

/** Draw the diagonal stamp on the CURRENT page. */
export function drawBudgetEstimateWatermark(doc: jsPDF, pageW: number, pageH: number): void {
  doc.saveGraphicsState();
  doc.setFont('helvetica', 'bold');
  // Size the text to the page diagonal so it fits letter/a4/tabloid alike.
  let fontSize = 34;
  doc.setFontSize(fontSize);
  const diag = Math.sqrt(pageW * pageW + pageH * pageH);
  const textW = doc.getTextWidth(BUDGET_ESTIMATE_WATERMARK);
  if (textW > diag * 0.72) {
    fontSize = Math.max(16, Math.floor(fontSize * ((diag * 0.72) / textW)));
    doc.setFontSize(fontSize);
  }
  // Light red — unmistakably a caution stamp, still legible underneath.
  doc.setTextColor(228, 148, 148);
  const angleDeg = (Math.atan2(pageH, pageW) * 180) / Math.PI;
  const w = doc.getTextWidth(BUDGET_ESTIMATE_WATERMARK);
  doc.text(
    BUDGET_ESTIMATE_WATERMARK,
    pageW / 2 - (w / 2) * Math.cos((angleDeg * Math.PI) / 180),
    pageH / 2 + (w / 2) * Math.sin((angleDeg * Math.PI) / 180),
    { angle: angleDeg },
  );
  doc.restoreGraphicsState();
}

/** Stamp EVERY page of a finished document — call right before doc.save(). */
export function stampBudgetEstimateAllPages(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    drawBudgetEstimateWatermark(doc, pw, ph);
  }
}

/** Fixed-position overlay for the HTML print fallback windows — position:fixed
 *  repeats on every printed page in Chromium/Firefox print engines. Inline
 *  styles are required here: this HTML is written into a bare print window
 *  that has no Tailwind runtime. */
export function budgetEstimatePrintOverlayHtml(): string {
  return `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;">
      <div style="transform:rotate(-32deg);font:800 42px 'Segoe UI',system-ui,sans-serif;color:rgba(220,60,60,0.16);white-space:nowrap;letter-spacing:2px;">
        ${BUDGET_ESTIMATE_WATERMARK}
      </div>
    </div>
    <div style="border:3px solid #dc2626;background:#fef2f2;color:#991b1b;font:700 14px 'Segoe UI',system-ui,sans-serif;text-align:center;padding:10px 16px;margin-bottom:20px;border-radius:8px;">
      ${BUDGET_ESTIMATE_WATERMARK}<br/>
      <span style="font-weight:400;font-size:11px;">Commercial project computed with residential-standard methodology. Not permit documentation.</span>
    </div>`;
}
