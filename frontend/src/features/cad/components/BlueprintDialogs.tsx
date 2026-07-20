import { useState, useEffect, useMemo } from 'react';
import * as fabric from 'fabric';
import { FileText, Crosshair, Sparkles, Loader2, AlertTriangle, Ruler } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import type { AiExtractRequest } from '../store/useCadStore';
import { parseFeetInches } from '../utils/underlayImport';
import { toast } from '../../../stores/useToastStore';
import { useGuidanceStore } from '../../../stores/useGuidanceStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import { scopedKey } from '../../../utils/storage';
import { api } from '../../../lib/api';
import type { AiBlueprintExtraction, AiExtractedRoom } from '../../../lib/api';
import { createDefaultRoom, createDefaultConditions } from '../../../engines/manualJ';
import type { RoomInput, DesignConditions } from '../../../engines/manualJ';
import { generateCadFloorFromManualJ } from '../../../engines/manualJToCad';
import { buildGeometryTakeoff, sanitizePolygon, impliesRescale } from '../../../engines/blueprintToCad';
import type { GeometryRoom, NormalizedPoint, UnderlayRect } from '../../../engines/blueprintToCad';
import { segmentsToWalls } from '../../../engines/pdfVector';
import type { VectorSegment } from '../../../engines/pdfVector';
import { traceUnderlayVectors, NoVectorSourceError } from '../utils/vectorTrace';
import type { VectorTraceResult } from '../utils/vectorTrace';

// Blueprint-intake dialogs for the CAD workspace:
//  - PdfPagePicker: multi-page PDF import paused awaiting a page choice
//  - CalibrateScale: two points clicked, awaiting the real-world distance
//  - AiExtract: Claude-vision room takeoff with mandatory human review
// All are driven by ephemeral store requests set from non-React code
// (underlayImport.ts) and the canvas mouse handlers.

export default function BlueprintDialogs() {
  const pdfPageRequest = useCadStore(s => s.pdfPageRequest);
  const calibrationRequest = useCadStore(s => s.calibrationRequest);
  const aiExtractRequest = useCadStore(s => s.aiExtractRequest);
  const underlayMigration = useCadStore(s => s.underlayMigration);
  const vectorTraceRequest = useCadStore(s => s.vectorTraceRequest);

  return (
    <>
      {/* Blocks first — sheets stay hidden until this is answered. */}
      {underlayMigration && <UnderlayMigrationPrompt />}
      {pdfPageRequest && <PdfPagePicker />}
      {calibrationRequest && <CalibrateScale />}
      {aiExtractRequest && <AiExtract />}
      {vectorTraceRequest && <VectorTrace />}
    </>
  );
}

// ── Legacy sheet re-anchor ───────────────────────────────────────────────────
// Blueprints used to be drawn centered on their stored x/y while every other
// part of the app treated x/y as the top-left, so a sheet appeared half its own
// size away from where the data placed it. Drawings saved before that fix are
// held back on load and resolved here rather than silently shifting.
function UnderlayMigrationPrompt() {
  const request = useCadStore(s => s.underlayMigration)!;
  const resolve = useCadStore(s => s.resolveUnderlayMigration);
  const n = request.sheetCount;
  const sheets = `${n} blueprint sheet${n === 1 ? '' : 's'}`;

  return (
    <DialogShell icon={<AlertTriangle className="w-5 h-5" />} title="Blueprint alignment update">
      <p className="text-sm text-slate-400 mb-3">
        This drawing has {sheets} saved before a fix to how blueprints are positioned.
        Previously a sheet was drawn centered on its stored point instead of anchored at its
        top-left corner, so it sat half a sheet away from the geometry traced against it.
      </p>
      <p className="text-sm text-slate-400 mb-4">
        Your walls, rooms, and load calculations are not affected either way — only where the
        blueprint image sits.
      </p>
      <div className="space-y-2 mb-5">
        <button
          onClick={() => resolve('reanchor')}
          className="w-full text-left min-h-[44px] px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors"
        >
          <span className="block text-sm font-medium text-emerald-200">Keep sheets where they look now</span>
          <span className="block text-xs text-slate-400 mt-0.5">
            Re-anchors each sheet so it stays exactly where you last saw it. Recommended.
          </span>
        </button>
        <button
          onClick={() => resolve('keep')}
          className="w-full text-left min-h-[44px] px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 hover:bg-slate-800 transition-colors"
        >
          <span className="block text-sm font-medium text-slate-200">Use the stored coordinates</span>
          <span className="block text-xs text-slate-400 mt-0.5">
            Anchors each sheet at its saved point. Sheets will shift by half their size.
          </span>
        </button>
      </div>
      <p className="text-xs text-slate-600">
        Either way you can drag a sheet afterwards, and this is asked only once per drawing.
      </p>
    </DialogShell>
  );
}

// variant 'modal' dims and blurs the whole workspace; 'panel' docks to the
// right WITHOUT a backdrop so the canvas stays visible — the AI takeoff review
// ghost-previews the proposed rooms on the canvas behind it.
function DialogShell({ icon, title, children, variant = 'modal' }: { icon: React.ReactNode; title: string; children: React.ReactNode; variant?: 'modal' | 'panel' }) {
  return (
    <div className={variant === 'modal'
      ? 'fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm'
      : 'fixed inset-0 z-[90] flex items-center justify-end pointer-events-none'}
    >
      <div className={`w-full max-w-md mx-4 rounded-2xl border border-slate-700/60 bg-slate-900/95 backdrop-blur-xl shadow-[0_0_48px_rgba(0,0,0,0.8)] p-6 ${variant === 'panel' ? 'pointer-events-auto' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">{icon}</div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function PdfPagePicker() {
  const request = useCadStore(s => s.pdfPageRequest)!;
  const setRequest = useCadStore(s => s.setPdfPageRequest);
  const [page, setPage] = useState('1');

  const finish = (choice: number | null) => {
    request.resolve(choice);
    setRequest(null);
  };

  const submit = () => {
    const parsed = parseInt(page, 10);
    finish(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), request.numPages) : 1);
  };

  return (
    <DialogShell icon={<FileText className="w-5 h-5" />} title="Choose Blueprint Page">
      <p className="text-sm text-slate-400 mb-4 break-words">
        <span className="text-slate-200">{request.fileName}</span> has {request.numPages} pages.
        Which page is the floor plan?
      </p>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="number"
          min={1}
          max={request.numPages}
          value={page}
          onChange={(e) => setPage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          autoFocus
          className="w-24 min-h-[44px] px-3 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 text-center focus:outline-none focus:border-sky-500/60"
          aria-label="Page number"
        />
        <span className="text-sm text-slate-500">of {request.numPages}</span>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => finish(null)}
          className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors text-sm"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-sky-500/20 border border-sky-500/50 text-sky-100 hover:bg-sky-500/30 transition-colors text-sm font-medium"
        >
          Import Page
        </button>
      </div>
    </DialogShell>
  );
}

function CalibrateScale() {
  const request = useCadStore(s => s.calibrationRequest)!;
  const setRequest = useCadStore(s => s.setCalibrationRequest);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const feet = parseFeetInches(value);
  const valid = feet !== null && feet > 0;

  // Escape cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRequest(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setRequest]);

  const apply = () => {
    if (!valid) {
      setError(`Could not read "${value}" as a distance. Try 24, 24.5, or 24' 6".`);
      return;
    }
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    const target = floor?.underlays?.find(u => u.id === request.underlayId);
    if (!target) {
      setRequest(null);
      toast.error('The underlay is no longer on this floor.');
      return;
    }

    // Uniform scale about p1 so the first clicked point stays put
    const k = (feet * state.projectScale.pxPerFt) / request.distPx;
    state.updateUnderlay(target.id, {
      x: request.p1.x + (target.x - request.p1.x) * k,
      y: request.p1.y + (target.y - request.p1.y) * k,
      width: target.width * k,
      height: target.height * k,
    });
    state.markDirty();
    setRequest(null);
    toast.success(`Scale calibrated — "${target.name}" is now true to size. Traced walls will read in real feet.`);
    // Next ideal action: trace walls over the calibrated blueprint
    useGuidanceStore.getState().setHint('cad_draw_wall');
  };

  return (
    <DialogShell icon={<Crosshair className="w-5 h-5" />} title="Calibrate Blueprint Scale">
      <p className="text-sm text-slate-400 mb-4">
        Real-world distance between the two points you clicked on{' '}
        <span className="text-slate-200 break-words">{request.underlayName}</span>:
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        autoFocus
        placeholder={'e.g. 24, 24.5, or 24\' 6"'}
        className="w-full min-h-[44px] px-3 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 focus:outline-none focus:border-sky-500/60 mb-2"
        aria-label="Real-world distance"
      />
      <div className="min-h-[20px] mb-4 text-xs">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : valid ? (
          <span className="text-emerald-400">= {feet.toFixed(2)} ft</span>
        ) : (
          <span className="text-slate-600">Accepts decimal feet, feet-inches, or inches (e.g. 30")</span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setRequest(null)}
          className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors text-sm"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-sky-500/20 border border-sky-500/50 text-sky-100 hover:bg-sky-500/30 transition-colors text-sm font-medium disabled:opacity-40"
        >
          Apply Scale
        </button>
      </div>
    </DialogShell>
  );
}

// ── Vector trace — exact geometry from a CAD-plotted PDF ─────────────────────
// No vision model: this reads the drawing's own line data, so positions are
// exact by construction. The length filter separates structure from lettering
// and dimension ticks, and the sheet can be discarded once converted.
function VectorTrace() {
  const request = useCadStore(s => s.vectorTraceRequest)!;
  const setRequest = useCadStore(s => s.setVectorTraceRequest);
  const pxPerFt = useCadStore(s => s.projectScale.pxPerFt);

  const [phase, setPhase] = useState<'loading' | 'review' | 'error'>('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState<VectorTraceResult | null>(null);
  const [minLenFt, setMinLenFt] = useState(1);
  const [strokesOnly, setStrokesOnly] = useState(true);
  const [removeSheet, setRemoveSheet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    traceUnderlayVectors(request.underlayId)
      .then(res => {
        if (cancelled) return;
        setResult(res);
        setPhase(res.segments.length > 0 ? 'review' : 'error');
        if (res.segments.length === 0) {
          // A refused sheet is empty for the opposite reason to a scan — it
          // carried too much geometry, not none. Saying "probably a scan" there
          // would send the user to the AI takeoff for no reason.
          setError(res.capped && res.notice
            ? res.notice
            : 'No vector geometry found on this sheet. It is most likely a scan or a photo — use the AI takeoff instead.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof NoVectorSourceError
          ? 'The original PDF is not loaded in this session. Re-import it to trace its vector geometry.'
          : err instanceof Error ? err.message : 'Vector trace failed');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [request]);

  // The sheet rect is needed both to place walls and to convert the length
  // filter from feet into the sheet's normalized units.
  const sheet = useMemo(() => {
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    return floor?.underlays?.find(u => u.id === request.underlayId) ?? null;
  }, [request]);

  const kept = useMemo(() => {
    if (!result || !sheet) return [] as VectorSegment[];
    // A normalized length maps to canvas px through the sheet's width, then to
    // feet through the project scale.
    const minNorm = (minLenFt * pxPerFt) / sheet.width;
    return result.segments.filter(s => {
      if (strokesOnly && s.kind !== 'stroke') return false;
      return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= minNorm;
    });
  }, [result, sheet, minLenFt, strokesOnly, pxPerFt]);

  // Ghost the runs that will be converted, directly on the sheet.
  useEffect(() => {
    const canvas = useCadStore.getState().canvas;
    if (!canvas || !sheet || kept.length === 0) return;
    const th = (sheet.rotation * Math.PI) / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    const place = (nx: number, ny: number) => {
      const lx = nx * sheet.width, ly = ny * sheet.height;
      return [sheet.x + lx * cos - ly * sin, sheet.y + lx * sin + ly * cos] as [number, number];
    };
    const objs = kept.map(s => {
      const [x1, y1] = place(s.x1, s.y1);
      const [x2, y2] = place(s.x2, s.y2);
      const line = new fabric.Line([x1, y1, x2, y2], {
        stroke: '#38bdf8', strokeWidth: 1.5,
        selectable: false, evented: false, objectCaching: false, excludeFromExport: true,
      });
      line.name = 'vector-preview';
      return line;
    });
    objs.forEach(o => canvas.add(o));
    canvas.requestRenderAll();
    return () => {
      objs.forEach(o => canvas.remove(o));
      canvas.requestRenderAll();
    };
  }, [kept, sheet]);

  const dismiss = () => setRequest(null);

  const confirm = () => {
    if (!sheet || kept.length === 0) return;
    const walls = segmentsToWalls(kept, sheet, { rValue: 13, thicknessIn: 6 });
    useCadStore.setState((s) => ({
      floors: s.floors.map(f => f.id !== s.activeFloorId ? f : {
        ...f,
        walls: [...f.walls, ...walls],
        underlays: removeSheet
          ? (f.underlays ?? []).filter(u => u.id !== request.underlayId)
          : (f.underlays ?? []).map(u => u.id === request.underlayId ? { ...u, opacity: Math.min(u.opacity, 0.45) } : u),
      }),
      isDirty: true,
      undoStack: [],
      redoStack: [],
    }));
    setRequest(null);
    // The trace is exact *relative* geometry — it inherits whatever scale the
    // sheet is currently at. That is only real-world-true once the sheet has
    // been calibrated, so say so and point at Calibrate Scale rather than
    // routing the user past it.
    toast.success(
      `${walls.length} run${walls.length === 1 ? '' : 's'} converted to CAD geometry, ` +
      `matching the drawing exactly at the sheet's current scale. ` +
      `Calibrate Scale off a known dimension to set real-world feet.` +
      (removeSheet ? ' Blueprint sheet removed — the drawing now stands on its own.' : ''),
    );
    useGuidanceStore.getState().setHint('cad_calibrate_scale');
  };

  return (
    <DialogShell icon={<Ruler className="w-5 h-5" />} title="Trace Vector Geometry" variant="panel">
      {phase === 'loading' && (
        <div className="flex flex-col items-center py-8 gap-3">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <p className="text-sm text-slate-400">Reading line geometry from <span className="text-slate-200 break-words">{request.underlayName}</span>…</p>
          <p className="text-xs text-slate-600">This reads the drawing's own vectors — no AI, no estimation.</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-2">
          <p className="text-sm text-red-400 mb-4 break-words">{error}</p>
          <div className="flex justify-end">
            <button onClick={dismiss} className="min-h-[44px] px-4 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors text-sm">Close</button>
          </div>
        </div>
      )}

      {phase === 'review' && result && sheet && (
        <div>
          <p className="text-xs text-emerald-400/90 mb-3">
            Exact geometry — positions come from the PDF's own line data, so every
            proportion and angle is measurement-for-measurement with no distortion.
            Real-world feet still come from Calibrate Scale.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-4">
            <dt className="text-slate-500">Runs found</dt>
            <dd className="text-slate-200 text-right">{result.rawCount.toLocaleString()}</dd>
            <dt className="text-slate-500">After removing duplicates</dt>
            <dd className="text-slate-200 text-right">{result.segments.length.toLocaleString()}</dd>
            <dt className="text-slate-500">Will convert</dt>
            <dd className="text-emerald-300 text-right font-medium">{kept.length.toLocaleString()}</dd>
            <dt className="text-slate-500">Sheet size</dt>
            <dd className="text-slate-200 text-right">
              {(result.pageWidthPt / 72).toFixed(1)}″ × {(result.pageHeightPt / 72).toFixed(1)}″
            </dd>
          </dl>

          <label className="block mb-4">
            <span className="text-xs text-slate-300">Ignore runs shorter than <span className="text-slate-100 font-medium">{minLenFt.toFixed(1)} ft</span></span>
            <input
              type="range" min={0} max={10} step={0.5}
              value={minLenFt}
              onChange={(e) => setMinLenFt(parseFloat(e.target.value))}
              className="w-full mt-2 accent-sky-500"
              aria-label="Minimum run length in feet"
            />
            <span className="block text-xs text-slate-500 mt-1">
              Raise this to drop lettering, dimension ticks, and hatching; lower it to keep short jogs and closet walls.
            </span>
          </label>

          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={strokesOnly} onChange={(e) => setStrokesOnly(e.target.checked)} className="w-4 h-4 accent-sky-500 mt-0.5 shrink-0" />
            <span className="text-xs text-slate-300">
              Outlines only
              <span className="block text-slate-500">Skips solid-filled areas such as poché and title-block panels.</span>
            </span>
          </label>

          <label className="flex items-start gap-2 mb-4 cursor-pointer">
            <input type="checkbox" checked={removeSheet} onChange={(e) => setRemoveSheet(e.target.checked)} className="w-4 h-4 accent-sky-500 mt-0.5 shrink-0" />
            <span className="text-xs text-slate-300">
              Remove the blueprint after converting
              <span className="block text-slate-500">The traced geometry replaces it. Otherwise the sheet stays as a faded reference.</span>
            </span>
          </label>

          <p className="text-xs text-slate-500 mb-4">
            Blue outlines on the canvas show exactly what will be converted. Everything lands as
            editable walls you can adjust, and nothing reaches a load calculation until you run one.
          </p>

          <div className="flex justify-end gap-2">
            <button onClick={dismiss} className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors text-sm">Cancel</button>
            <button
              onClick={confirm}
              disabled={kept.length === 0}
              className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-sky-500/20 border border-sky-500/50 text-sky-100 hover:bg-sky-500/30 transition-colors text-sm font-medium disabled:opacity-40"
            >
              Convert {kept.length.toLocaleString()}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

// ── AI extraction — review-and-confirm takeoff ───────────────────────────────
// Sends the underlay raster to the Worker's Claude endpoint and presents the
// proposed rooms for review. NOTHING becomes calculator input until the user
// confirms — extracted values feed a legally binding load calc, and ACCA
// prohibits silently defaulted engineering inputs.

type EditableRoom = AiExtractedRoom & { included: boolean };

// Extracted dimensions are untrusted model output that feeds a legally binding
// load calculation. A room dimension outside this band is a misread, not a
// building — accepting it would silently poison Manual J (and, via the implied
// scale, the CAD geometry). Bounds are deliberately generous: the reviewer
// edits real outliers by hand.
const MAX_ROOM_DIM_FT = 500;
const MIN_ROOM_DIM_FT = 0.5;
function dimsUsable(r: { lengthFt: number; widthFt: number }): boolean {
  const ok = (v: number) => Number.isFinite(v) && v >= MIN_ROOM_DIM_FT && v <= MAX_ROOM_DIM_FT;
  return ok(r.lengthFt) && ok(r.widthFt);
}

// Split reviewed rooms into geometry-capable (usable traced outline whose
// source sheet is still on the active floor) and Manual-J-only. Sheets can be
// deleted mid-review, so imageIndex is remapped against the surviving rects.
function splitGeometry(rooms: EditableRoom[], request: AiExtractRequest): {
  rects: UnderlayRect[];
  geom: Array<{ src: EditableRoom; polygon: NormalizedPoint[]; imageIndex: number }>;
  manualOnly: EditableRoom[];
} {
  const state = useCadStore.getState();
  const floor = state.floors.find(f => f.id === state.activeFloorId);
  const idxMap = new Map<number, number>();
  const rects: UnderlayRect[] = [];
  request.underlayIds.forEach((id, i) => {
    const u = floor?.underlays?.find(x => x.id === id);
    if (u) {
      idxMap.set(i, rects.length);
      rects.push({ id: u.id, x: u.x, y: u.y, width: u.width, height: u.height, rotation: u.rotation });
    }
  });
  const geom: Array<{ src: EditableRoom; polygon: NormalizedPoint[]; imageIndex: number }> = [];
  const manualOnly: EditableRoom[] = [];
  for (const r of rooms) {
    const polygon = sanitizePolygon(r.polygon);
    const mapped = idxMap.get(r.imageIndex ?? 0);
    if (polygon && mapped !== undefined) geom.push({ src: r, polygon, imageIndex: mapped });
    else manualOnly.push(r);
  }
  return { rects, geom, manualOnly };
}

function AiExtract() {
  const request = useCadStore(s => s.aiExtractRequest)!;
  const setRequest = useCadStore(s => s.setAiExtractRequest);

  const [phase, setPhase] = useState<'loading' | 'review' | 'error'>('loading');
  const [error, setError] = useState('');
  const [extraction, setExtraction] = useState<AiBlueprintExtraction | null>(null);
  const [rooms, setRooms] = useState<EditableRoom[]>([]);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    const projectId = useProjectStore.getState().activeProjectId;
    api.extractBlueprint(request.dataUrls, projectId ?? undefined, request.underlayName)
      .then(({ extraction: ex }) => {
        if (cancelled) return;
        setExtraction(ex);
        setRooms(ex.rooms.map(r => ({ ...r, included: true })));
        setPhase('review');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Extraction failed');
        setPhase('error');
        // AI couldn't help — hint the manual path instead
        useGuidanceStore.getState().setHint('cad_calibrate_scale');
      });
    return () => { cancelled = true; };
  }, [request]);

  // Closing without importing → the manual takeoff is the next ideal path
  const dismiss = () => {
    setRequest(null);
    useGuidanceStore.getState().setHint('cad_calibrate_scale');
  };

  const updateRoom = (i: number, patch: Partial<EditableRoom>) => {
    setRooms(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const includedCount = rooms.filter(r => r.included).length;

  // Geometry dry-run over the included rooms: powers the on-canvas ghost
  // preview, the implied-scale readout, and the reviewer warnings. Alignment
  // against the sheets is scale-invariant, so the preview always maps through
  // the CURRENT placement (applyScale false) — on confirm the sheet resizes
  // together with the NEW walls this takeoff produces. Walls already on the
  // floor are not carried along.
  const [autoScale, setAutoScale] = useState(true);
  const pxPerFt = useCadStore(s => s.projectScale.pxPerFt);
  // Subscribing to floors keeps the ghost preview honest if the user moves or
  // rescales an underlay mid-review — the canvas stays interactive behind the
  // panel, and splitGeometry re-reads the live rects on every recompute.
  const floors = useCadStore(s => s.floors);
  const geometryPreview = useMemo(() => {
    if (phase !== 'review') return null;
    const included = rooms.filter(r => r.included && dimsUsable(r));
    const { rects, geom } = splitGeometry(included, request);
    if (geom.length === 0) return null;
    const geomRooms: GeometryRoom[] = geom.map(g => ({
      name: g.src.name.trim() || 'Room',
      lengthFt: g.src.lengthFt,
      widthFt: g.src.widthFt,
      wallRValue: 13, // preview only cares about geometry
      confidence: g.src.confidence,
      polygon: g.polygon,
      imageIndex: g.imageIndex,
    }));
    // Ghost outlines always map through the CURRENT sheet placement (alignment
    // is scale-invariant), but warnings are assessed at the scale the user is
    // about to APPLY — otherwise every uncalibrated sheet would cry mismatch
    // on dimensions the auto-scale is precisely about to fix.
    const ghost = buildGeometryTakeoff(geomRooms, rects, pxPerFt, { applyScale: false });
    const assessed = autoScale ? buildGeometryTakeoff(geomRooms, rects, pxPerFt, { applyScale: true }) : ghost;
    return { roomPolygons: ghost.roomPolygons, impliedPxPerFt: ghost.impliedPxPerFt, warnings: assessed.warnings };
  }, [phase, rooms, request, pxPerFt, autoScale, floors]);

  const implied = geometryPreview?.impliedPxPerFt ?? null;
  // Ask the engine, don't re-derive: a local 2% gate used to call a 0.5%
  // mismatch a "no-op" while the engine still rescaled and re-tiled every
  // sheet, silently discarding a hand-made arrangement.
  const willRescale = impliesRescale(implied, pxPerFt);

  // Ghost the proposed rooms on the canvas behind the review panel.
  useEffect(() => {
    const canvas = useCadStore.getState().canvas;
    if (!canvas || !geometryPreview) return;
    const objs = geometryPreview.roomPolygons.map(p => {
      const poly = new fabric.Polygon(p.points, {
        fill: 'rgba(52,211,153,0.08)',
        stroke: '#34d399',
        strokeWidth: 1.5,
        strokeDashArray: [6, 4],
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
      });
      poly.name = 'ai-preview';
      return poly;
    });
    objs.forEach(o => canvas.add(o));
    canvas.requestRenderAll();
    return () => {
      objs.forEach(o => canvas.remove(o));
      canvas.requestRenderAll();
    };
  }, [geometryPreview]);

  const confirm = () => {
    // Every checked room is imported. A reviewer who blanks a name has not
    // asked to discard the room — dropping it here would lose an engineering
    // input the button already counted, with nothing said. Blank names fall
    // back to the default below, the same way the ghost preview does. Keeping
    // this filter identical to the preview's is also what makes `rejected`
    // below honest: checked === includedCount, so the only rooms unaccounted
    // for are the ones the dimension band actually rejected.
    const checked = rooms.filter(r => r.included);
    const selected = checked.filter(dimsUsable);
    if (selected.length === 0) {
      toast.warning(
        checked.length > 0
          ? `No usable rooms — every selected room has a dimension outside ${MIN_ROOM_DIM_FT}–${MAX_ROOM_DIM_FT} ft. Correct them before importing.`
          : 'No rooms selected — check at least one room to import.',
      );
      return;
    }
    const rejected = checked.length - selected.length;
    if (rejected > 0) {
      toast.warning(`${rejected} room${rejected === 1 ? '' : 's'} skipped — dimensions outside ${MIN_ROOM_DIM_FT}–${MAX_ROOM_DIM_FT} ft. Correct and re-run to include them.`);
    }

    // Append to the Manual J project-scoped inputs (same storage contract the
    // calculator's own auto-save uses; the page hydrates from it on mount).
    const projectId = useProjectStore.getState().activeProjectId;
    const key = scopedKey(`hvac_manualj_inputs_${projectId || 'draft'}`);
    let existing: { buildingType?: string; rooms?: RoomInput[]; conditions?: DesignConditions } | null = null;
    try { existing = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* corrupt — start fresh */ }
    const baseRooms: RoomInput[] = Array.isArray(existing?.rooms) ? existing.rooms : [];

    const newRooms: RoomInput[] = selected.map((r, i) => {
      const base = createDefaultRoom(baseRooms.length + i);
      return {
        ...base,
        // Blank name → keep the default "Room N" rather than dropping the room.
        name: r.name.trim() || base.name,
        lengthFt: r.lengthFt,
        widthFt: r.widthFt,
        ...(r.ceilingHeightFt ? { ceilingHeightFt: r.ceilingHeightFt } : {}),
        ...(r.windowCount != null ? { windowCount: r.windowCount } : {}),
        ...(r.exposureDirection ? { exposureDirection: r.exposureDirection } : {}),
      };
    });

    try {
      localStorage.setItem(key, JSON.stringify({
        buildingType: existing?.buildingType ?? 'residential',
        rooms: [...baseRooms, ...newRooms],
        conditions: existing?.conditions ?? createDefaultConditions(),
      }));
    } catch {
      toast.error('Could not save rooms (storage full).');
      return;
    }

    // Redraw the extracted plan as real CAD geometry. Rooms with a traced
    // outline land at their TRUE position on the active floor — walls on top
    // of the sheet's own lines, measurement for measurement — optionally
    // auto-calibrating the sheet scale from the printed dimensions. Rooms
    // without a usable outline are never given an invented position on a real
    // plan; they go to Manual J only. If NO outlines came back, fall back to
    // the legacy packed layout on a separate floor.
    const cadState = useCadStore.getState();
    const { rects, geom, manualOnly } = splitGeometry(selected, request);

    if (geom.length > 0) {
      const geomRooms: GeometryRoom[] = geom.map(g => {
        const idx = selected.indexOf(g.src);
        return {
          // Read the name back off the Manual J row so the CAD room and the
          // load-calc row can never disagree, including on the blank fallback.
          name: newRooms[idx].name,
          lengthFt: g.src.lengthFt,
          widthFt: g.src.widthFt,
          wallRValue: newRooms[idx].wallRValue,
          confidence: g.src.confidence,
          polygon: g.polygon,
          imageIndex: g.imageIndex,
        };
      });
      const res = buildGeometryTakeoff(geomRooms, rects, cadState.projectScale.pxPerFt, { applyScale: autoScale });
      useCadStore.setState((s) => ({
        floors: s.floors.map(f => f.id !== s.activeFloorId ? f : {
          ...f,
          walls: [...f.walls, ...res.walls],
          rooms: [...f.rooms, ...res.rooms],
          // Apply auto-scale placement, and dim the source sheets so the new
          // walls read clearly against the drawing.
          underlays: (f.underlays ?? []).map(u => {
            const patch = res.underlayPatches.find(p => p.id === u.id);
            const dimmed = request.underlayIds.includes(u.id) ? Math.min(u.opacity, 0.6) : u.opacity;
            return patch
              ? { ...u, x: patch.x, y: patch.y, width: patch.width, height: patch.height, opacity: dimmed }
              : { ...u, opacity: dimmed };
          }),
        }),
        isDirty: true,
        undoStack: [],
        redoStack: [],
      }));
      setRequest(null);
      const manualNote = manualOnly.length > 0
        ? ` ${manualOnly.length} room${manualOnly.length === 1 ? ' had' : 's had'} no traceable outline — added to Manual J only.`
        : '';
      toast.success(`${geom.length} room${geom.length === 1 ? '' : 's'} drawn true to the blueprint and added to Manual J.${manualNote} Review the walls, then calculate loads.`);
    } else {
      const newFloor = generateCadFloorFromManualJ(
        newRooms,
        cadState.projectScale.pxPerFt,
        'grid',
        cadState.floors.length,
      );
      newFloor.name = 'AI Takeoff';
      useCadStore.setState((s) => ({
        floors: [...s.floors, newFloor],
        activeFloorId: newFloor.id,
        isDirty: true,
        undoStack: [],
        redoStack: [],
      }));
      setRequest(null);
      toast.success(`${newRooms.length} room${newRooms.length === 1 ? '' : 's'} drawn on the "AI Takeoff" floor and added to Manual J (no traceable outlines came back, so the layout is schematic). Finalize the plan here, then calculate loads.`);
    }
    useGuidanceStore.getState().setHint('mj_calculate');
  };

  const confidenceColor: Record<AiExtractedRoom['confidence'], string> = {
    high: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
    medium: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
    low: 'text-red-400 border-red-500/40 bg-red-500/10',
  };

  return (
    <DialogShell icon={<Sparkles className="w-5 h-5" />} title="AI Blueprint Takeoff" variant="panel">
      {phase === 'loading' && (
        <div className="flex flex-col items-center py-8 gap-3">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <p className="text-sm text-slate-400">
            Reading <span className="text-slate-200 break-words">{request.underlayName}</span>…
          </p>
          <p className="text-xs text-slate-600">Extracting the room schedule for review — nothing is applied automatically.</p>
          <button
            onClick={dismiss}
            className="mt-2 min-h-[44px] px-4 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-2">
          <p className="text-sm text-red-400 mb-4 break-words">{error}</p>
          <p className="text-xs text-slate-500 mb-4">
            You can still take off the plan manually: Calibrate Scale, trace walls, then Detect Rooms.
          </p>
          <div className="flex justify-end">
            <button
              onClick={dismiss}
              className="min-h-[44px] px-4 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === 'review' && extraction && (
        <div>
          {extraction.buildingType === 'commercial' && (
            <div className="flex gap-2 items-start mb-3 p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This looks like a <strong>commercial / assembly</strong> building. Manual J is residential-only —
                results are a budget estimate, not a permit-grade load calc (Manual N is on the roadmap).
              </span>
            </div>
          )}
          {extraction.warnings.length > 0 && (
            <ul className="mb-3 space-y-1">
              {extraction.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-400/90 flex gap-1.5">
                  <span className="shrink-0">⚠</span><span className="break-words">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {extraction.scaleNote && (
            <p className="text-xs text-slate-500 mb-3 break-words">Scale reference: {extraction.scaleNote}</p>
          )}
          {geometryPreview && geometryPreview.warnings.length > 0 && (
            <ul className="mb-3 space-y-1">
              {geometryPreview.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-400/90 flex gap-1.5">
                  <span className="shrink-0">⚠</span><span className="break-words">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {geometryPreview && (
            <p className="text-xs text-emerald-400/80 mb-3">
              Dashed green outlines on the canvas show where the traced rooms will land — on the blueprint itself, not a generated layout.
            </p>
          )}
          {implied !== null && (
            <label className="flex items-start gap-2 mb-3 p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScale}
                onChange={(e) => setAutoScale(e.target.checked)}
                className="w-4 h-4 accent-sky-500 mt-0.5 shrink-0"
              />
              <span className="text-xs text-slate-300">
                Auto-calibrate sheet scale from printed dimensions
                <span className="block text-slate-500 mt-0.5">
                  {willRescale
                    ? `The sheet currently reads ≈ ${implied.toFixed(1)} px/ft; the project scale is ${pxPerFt} px/ft. The sheet will be resized — and repositioned alongside any other sheets — together with the new walls from this takeoff, so those read in true feet. Walls you traced by hand earlier are not moved and will no longer line up with the sheet.`
                    : 'The sheet already matches the project scale — nothing will be moved or resized.'}
                </span>
              </span>
            </label>
          )}

          <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1 mb-4">
            {rooms.length === 0 && (
              <p className="text-sm text-slate-500 py-4">No rooms were identified on this page.</p>
            )}
            {rooms.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 py-2 border-b border-slate-800 ${r.included ? '' : 'opacity-40'}`}>
                <input
                  type="checkbox"
                  checked={r.included}
                  onChange={(e) => updateRoom(i, { included: e.target.checked })}
                  className="w-4 h-4 accent-sky-500 shrink-0"
                  aria-label={`Include ${r.name}`}
                />
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => updateRoom(i, { name: e.target.value })}
                  className="flex-1 min-w-0 min-h-[36px] px-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-sky-500/60"
                  aria-label="Room name"
                />
                <input
                  type="number"
                  value={r.lengthFt}
                  onChange={(e) => updateRoom(i, { lengthFt: parseFloat(e.target.value) || 0 })}
                  className="w-16 min-h-[36px] px-1 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-100 text-sm text-center focus:outline-none focus:border-sky-500/60"
                  aria-label="Length in feet"
                />
                <span className="text-slate-600 text-xs">×</span>
                <input
                  type="number"
                  value={r.widthFt}
                  onChange={(e) => updateRoom(i, { widthFt: parseFloat(e.target.value) || 0 })}
                  className="w-16 min-h-[36px] px-1 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-100 text-sm text-center focus:outline-none focus:border-sky-500/60"
                  aria-label="Width in feet"
                />
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[10px] font-medium uppercase ${
                    dimsUsable(r) ? confidenceColor[r.confidence] : 'text-red-400 border-red-500/40 bg-red-500/10'
                  }`}
                  title={dimsUsable(r) ? (r.notes || undefined) : `Dimensions must be between ${MIN_ROOM_DIM_FT} and ${MAX_ROOM_DIM_FT} ft — this room will be skipped.`}
                >
                  {dimsUsable(r) ? r.confidence : 'check'}
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500 mb-4">
            Review every dimension against the plan before importing — you are the engineer of record, not the AI.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={dismiss}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={includedCount === 0}
              className="min-h-[44px] min-w-[44px] px-5 rounded-xl bg-sky-500/20 border border-sky-500/50 text-sky-100 hover:bg-sky-500/30 transition-colors text-sm font-medium disabled:opacity-40"
            >
              Draw {includedCount} in CAD + Manual J
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
