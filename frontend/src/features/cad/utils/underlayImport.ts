import { useCadStore } from '../store/useCadStore';
import type { UnderlayImage } from '../store/useCadStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useGuidanceStore } from '../../../stores/useGuidanceStore';
import { toast } from '../../../stores/useToastStore';
import { api } from '../../../lib/api';

// Shared underlay import pipeline — used by both the Toolbox "Import Image"
// button and drag-and-drop onto the canvas. Images become underlays directly;
// PDFs are rasterized page-by-page via lazy-loaded pdf.js (never in the main
// bundle). The original file is also persisted to R2 (purpose 'blueprint')
// when a project is active — best-effort, offline-first.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
// Longest raster side for a PDF page — enough to keep dimension strings
// legible when zoomed, without bloating the serialized drawing payload.
const MAX_RASTER_DIM = 2400;

export function importUnderlayFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    void importSingleFile(file);
  }
}

async function importSingleFile(file: File): Promise<void> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  if (isPdf) {
    if (file.size > MAX_PDF_BYTES) {
      toast.error(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). PDF maximum is 25 MB.`);
      return;
    }
    try {
      const raster = await rasterizePdf(file);
      if (!raster) return; // user cancelled page selection
      placeUnderlay(raster.dataUrl, file.name, raster.width, raster.height);
      persistBlueprint(file);
      toast.success(`Imported "${file.name}" — use Calibrate Scale to set real-world dimensions.`);
    } catch {
      toast.error(`Could not read "${file.name}". The PDF may be corrupt or password-protected.`);
    }
    return;
  }

  if (!IMAGE_TYPES.includes(file.type)) {
    toast.warning(`"${file.name}" is not a supported format. Use PDF, PNG, JPG, GIF, WebP, or SVG.`);
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Image maximum is 10 MB.`);
    return;
  }

  const dataUrl = await readAsDataUrl(file);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    placeUnderlay(dataUrl, file.name, img.naturalWidth, img.naturalHeight);
    persistBlueprint(file);
  };
  img.src = dataUrl;
}

// ── PDF rasterization (lazy pdf.js) ─────────────────────────────────────────
async function rasterizePdf(file: File): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    let pageNum = 1;
    if (doc.numPages > 1) {
      const choice = await new Promise<number | null>((resolve) => {
        useCadStore.getState().setPdfPageRequest({ fileName: file.name, numPages: doc.numPages, resolve });
      });
      if (choice === null) return null;
      pageNum = Math.min(Math.max(choice, 1), doc.numPages);
    }

    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(Math.max(MAX_RASTER_DIM / Math.max(base.width, base.height), 1), 4);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, viewport }).promise;
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    void loadingTask.destroy();
  }
}

// ── Placement (matches historical import behavior: fit 600×400, center) ─────
function placeUnderlay(dataUrl: string, name: string, naturalW: number, naturalH: number): void {
  let w = naturalW;
  let h = naturalH;
  const maxW = 600;
  const maxH = 400;
  if (w > maxW) { const r = maxW / w; w *= r; h *= r; }
  if (h > maxH) { const r = maxH / h; w *= r; h *= r; }

  const state = useCadStore.getState();
  const canvas = state.canvas;
  let cx = 300, cy = 300;
  if (canvas) {
    const vpt = canvas.viewportTransform;
    const zoom = canvas.getZoom();
    if (vpt) {
      cx = ((canvas.width ?? 800) / 2 - vpt[4]) / zoom;
      cy = ((canvas.height ?? 600) / 2 - vpt[5]) / zoom;
    }
  }

  const underlay: UnderlayImage = {
    id: `underlay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    dataUrl,
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    locked: false,
  };

  state.addUnderlay(underlay);
  state.markDirty();

  // Next ideal action: calibrate the blueprint so traced walls read in real feet
  useGuidanceStore.getState().setHint('cad_calibrate_scale');
}

// ── R2 persistence (best-effort, never blocks the local-first flow) ─────────
function persistBlueprint(file: File): void {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) return; // draft mode — local only
  api.uploadFile(file, 'blueprint', projectId)
    .then(() => toast.info('Blueprint saved to project files.'))
    .catch(() => { /* offline or auth lapse — underlay still works locally */ });
}

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve((ev.target?.result as string) ?? null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ── Distance parsing for scale calibration ──────────────────────────────────
// Accepts decimal feet ("24", "24.5") and feet-inches ("24' 6\"", "24ft 6in",
// "24-6"). Returns feet, or null if unparseable.
export function parseFeetInches(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/feet|foot|ft\.?/g, "'").replace(/inches|inch|in\.?/g, '"');
  if (!s) return null;

  // feet-inches: 24' 6"  |  24'6  |  24-6
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?\s*$/) ?? s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)\s*"?\s*$/);
  if (ftIn) {
    const feet = parseFloat(ftIn[1]);
    const inches = ftIn[2] !== undefined ? parseFloat(ftIn[2]) : 0;
    if (!Number.isFinite(feet) || !Number.isFinite(inches) || inches >= 12) return null;
    return feet + inches / 12;
  }

  // inches only: 30"
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inOnly) {
    const inches = parseFloat(inOnly[1]);
    return Number.isFinite(inches) ? inches / 12 : null;
  }

  // plain decimal feet
  const feet = parseFloat(s);
  return Number.isFinite(feet) && /^\d+(\.\d+)?$/.test(s) ? feet : null;
}
