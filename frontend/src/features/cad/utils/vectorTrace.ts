import { extractVectorSegments, dedupeSegments } from '../../../engines/pdfVector';
import type { VectorSegment, OpsCodes } from '../../../engines/pdfVector';
import { getPdfSource } from './underlayImport';

// Loads the PDF behind an underlay and pulls its true line geometry. Everything
// numeric lives in engines/pdfVector.ts; this file only handles pdf.js loading
// so the engine stays pure and unit-testable.

export interface VectorTraceResult {
  segments: VectorSegment[];
  rawCount: number;
  curveCount: number;
  pageWidthPt: number;
  pageHeightPt: number;
}

export class NoVectorSourceError extends Error {
  constructor() {
    super('The original PDF for this sheet is not loaded in this session.');
    this.name = 'NoVectorSourceError';
  }
}

export async function traceUnderlayVectors(underlayId: string): Promise<VectorTraceResult> {
  const source = getPdfSource(underlayId);
  if (!source) throw new NoVectorSourceError();

  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await source.file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(source.pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const opList = await page.getOperatorList();

    const sheet = extractVectorSegments(
      opList as unknown as { fnArray: number[]; argsArray: unknown[] },
      pdfjs.OPS as unknown as OpsCodes,
      { width: viewport.width, height: viewport.height, transform: viewport.transform },
    );
    const deduped = dedupeSegments(sheet.segments);
    return {
      segments: deduped,
      rawCount: sheet.segments.length,
      curveCount: sheet.curveCount,
      pageWidthPt: sheet.pageWidthPt,
      pageHeightPt: sheet.pageHeightPt,
    };
  } finally {
    void loadingTask.destroy();
  }
}

/** Longest-run-first, so a length cutoff keeps structure and drops lettering. */
export function segmentLengthsNorm(segments: VectorSegment[]): number[] {
  return segments.map(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).sort((a, b) => b - a);
}
