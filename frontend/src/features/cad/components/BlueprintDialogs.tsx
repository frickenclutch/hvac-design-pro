import { useState, useEffect } from 'react';
import { FileText, Crosshair, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
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

  return (
    <>
      {pdfPageRequest && <PdfPagePicker />}
      {calibrationRequest && <CalibrateScale />}
      {aiExtractRequest && <AiExtract />}
    </>
  );
}

function DialogShell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-slate-700/60 bg-slate-900/95 backdrop-blur-xl shadow-[0_0_48px_rgba(0,0,0,0.8)] p-6">
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

// ── AI extraction — review-and-confirm takeoff ───────────────────────────────
// Sends the underlay raster to the Worker's Claude endpoint and presents the
// proposed rooms for review. NOTHING becomes calculator input until the user
// confirms — extracted values feed a legally binding load calc, and ACCA
// prohibits silently defaulted engineering inputs.

type EditableRoom = AiExtractedRoom & { included: boolean };

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

  const confirm = () => {
    const selected = rooms.filter(r => r.included && r.name.trim() && r.lengthFt > 0 && r.widthFt > 0);
    if (selected.length === 0) {
      toast.warning('No rooms selected — check at least one room to import.');
      return;
    }

    // Append to the Manual J project-scoped inputs (same storage contract the
    // calculator's own auto-save uses; the page hydrates from it on mount).
    const projectId = useProjectStore.getState().activeProjectId;
    const key = scopedKey(`hvac_manualj_inputs_${projectId || 'draft'}`);
    let existing: { buildingType?: string; rooms?: RoomInput[]; conditions?: DesignConditions } | null = null;
    try { existing = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* corrupt — start fresh */ }
    const baseRooms: RoomInput[] = Array.isArray(existing?.rooms) ? existing.rooms : [];

    const newRooms: RoomInput[] = selected.map((r, i) => ({
      ...createDefaultRoom(baseRooms.length + i),
      name: r.name.trim(),
      lengthFt: r.lengthFt,
      widthFt: r.widthFt,
      ...(r.ceilingHeightFt ? { ceilingHeightFt: r.ceilingHeightFt } : {}),
      ...(r.windowCount != null ? { windowCount: r.windowCount } : {}),
      ...(r.exposureDirection ? { exposureDirection: r.exposureDirection } : {}),
    }));

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

    // Redraw the extracted plan as real CAD geometry on a new floor so the
    // designer can finalize it — adjust walls, place openings and equipment,
    // stamp, and export — before anything gets printed or produced.
    const cadState = useCadStore.getState();
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
    toast.success(`${newRooms.length} room${newRooms.length === 1 ? '' : 's'} drawn on the "AI Takeoff" floor and added to Manual J. Finalize the plan here, then calculate loads.`);
    useGuidanceStore.getState().setHint('mj_calculate');
  };

  const confidenceColor: Record<AiExtractedRoom['confidence'], string> = {
    high: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
    medium: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
    low: 'text-red-400 border-red-500/40 bg-red-500/10',
  };

  return (
    <DialogShell icon={<Sparkles className="w-5 h-5" />} title="AI Blueprint Takeoff">
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
                <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[10px] font-medium uppercase ${confidenceColor[r.confidence]}`} title={r.notes || undefined}>
                  {r.confidence}
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
