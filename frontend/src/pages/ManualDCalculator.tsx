import { useState, useRef, useEffect, useCallback } from 'react';
import {
  GitBranch, Wind, Gauge, ArrowRight, RotateCcw,
  Plus, Trash2, ChevronDown, AlertTriangle, CheckCircle, Info,
} from 'lucide-react';
import {
  calculateManualD,
  type ManualDSystemInput, type ManualDRoomInput, type ManualDResult,
  type DuctMaterial, type DuctShape, type FittingType,
} from '../engines/manualD';
import { useCadStore } from '../features/cad/store/useCadStore';
import { useProjectStore } from '../stores/useProjectStore';
import Mason from '../components/Mason';

const STORAGE_KEY = 'hvac_manuald_inputs';
const MANUALJ_KEY = 'hvac_manualj_inputs';
const MANUALJ_RESULTS_KEY = 'hvac_manualj_results';

type SavedState = { application: 'residential' | 'commercial'; equipmentCfm: number; blowerEsp: number; filterDrop: number; coilDrop: number; ductMaterial: DuctMaterial; preferredShape: DuctShape; maxAspectRatio: number; rooms: ManualDRoomInput[] };

function loadSaved(): SavedState | null { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveState(s: SavedState) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* */ } }

const FITTING_OPTIONS: { value: FittingType; label: string }[] = [
  { value: 'elbow_90', label: '90-deg Elbow' },
  { value: 'elbow_45', label: '45-deg Elbow' },
  { value: 'tee_branch', label: 'Tee (Branch)' },
  { value: 'wye', label: 'Wye' },
  { value: 'reducer', label: 'Reducer' },
  { value: 'register_boot', label: 'Register Boot' },
  { value: 'return_boot', label: 'Return Boot' },
  { value: 'takeoff_round', label: 'Round Takeoff' },
  { value: 'damper_manual', label: 'Manual Damper' },
];

const MATERIAL_OPTIONS: [DuctMaterial, string][] = [
  ['sheet_metal', 'Sheet Metal'],
  ['flex_r4', 'Flex (R-4)'],
  ['flex_r6', 'Flex (R-6)'],
  ['flex_r8', 'Flex (R-8)'],
  ['spiral', 'Spiral'],
  ['fiberglass_board', 'Fiberglass Board'],
  ['fabric', 'Fabric'],
  ['pvc', 'PVC'],
];

let _nextId = 1;
function uid() { return `md_${Date.now()}_${_nextId++}`; }

function createDefaultRoom(index: number): ManualDRoomInput {
  return {
    roomId: uid(),
    roomName: `Room ${index + 1}`,
    requiredCfm: 100,
    actualLengthFt: 20,
    fittings: [
      { type: 'takeoff_round', qty: 1 },
      { type: 'elbow_90', qty: 1 },
      { type: 'register_boot', qty: 1 },
    ],
  };
}

export default function ManualDCalculator() {
  const saved = useRef(loadSaved()).current;

  const [application, setApplication] = useState<'residential' | 'commercial'>(saved?.application ?? 'residential');
  const [equipmentCfm, setEquipmentCfm] = useState(saved?.equipmentCfm ?? 1200);
  const [blowerEsp, setBlowerEsp] = useState(saved?.blowerEsp ?? 0.5);
  const [filterDrop, setFilterDrop] = useState(saved?.filterDrop ?? 0.1);
  const [coilDrop, setCoilDrop] = useState(saved?.coilDrop ?? 0.2);
  const [ductMaterial, setDuctMaterial] = useState<DuctMaterial>(saved?.ductMaterial ?? 'sheet_metal');
  const [preferredShape, setPreferredShape] = useState<DuctShape>(saved?.preferredShape ?? 'round');
  const [maxAspectRatio, setMaxAspectRatio] = useState(saved?.maxAspectRatio ?? 4);
  const [rooms, setRooms] = useState<ManualDRoomInput[]>(saved?.rooms ?? [createDefaultRoom(0)]);
  const [result, setResult] = useState<ManualDResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [fittingEditorId, setFittingEditorId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const activeProjectName = useProjectStore((s) => s.activeProjectName);

  // Auto-save
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    saveState({ application, equipmentCfm, blowerEsp, filterDrop, coilDrop, ductMaterial, preferredShape, maxAspectRatio, rooms });
    setSaveStatus('saved');
    const t = setTimeout(() => setSaveStatus('idle'), 1500);
    return () => clearTimeout(t);
  }, [application, equipmentCfm, blowerEsp, filterDrop, coilDrop, ductMaterial, preferredShape, maxAspectRatio, rooms]);

  const addRoom = useCallback(() => {
    setRooms(prev => [...prev, createDefaultRoom(prev.length)]);
    setResult(null);
  }, []);

  const removeRoom = useCallback((id: string) => {
    setRooms(prev => prev.length > 1 ? prev.filter(r => r.roomId !== id) : prev);
    setResult(null);
  }, []);

  const updateRoom = useCallback((id: string, patch: Partial<ManualDRoomInput>) => {
    setRooms(prev => prev.map(r => r.roomId === id ? { ...r, ...patch } : r));
    setResult(null);
  }, []);

  const importFromManualJ = useCallback(() => {
    try {
      // First try to load calculated results (preferred — has actual BTU loads)
      const resultsRaw = localStorage.getItem(MANUALJ_RESULTS_KEY);
      const inputsRaw = localStorage.getItem(MANUALJ_KEY);

      if (!resultsRaw && !inputsRaw) {
        alert('No Manual J data found. Run a Manual J calculation first.');
        return;
      }

      if (resultsRaw) {
        // Use calculated results — proper CFM distribution from cooling loads
        const results = JSON.parse(resultsRaw);
        if (!results.rooms || !Array.isArray(results.rooms)) {
          alert('Invalid Manual J results. Please re-run the Manual J calculation.');
          return;
        }

        const totalCoolingBtu = results.totalCoolingBtu || results.rooms.reduce((s: number, r: any) => s + (r.coolingBtuTotal || 0), 0);
        const systemCfm = Math.round((results.recommendedTons || 3) * 400);

        const imported: ManualDRoomInput[] = results.rooms.map((r: any) => {
          const roomCfm = totalCoolingBtu > 0
            ? Math.round(systemCfm * ((r.coolingBtuTotal || 0) / totalCoolingBtu))
            : Math.round(systemCfm / results.rooms.length);

          return {
            roomId: uid(),
            roomName: r.roomName || r.name || 'Unknown Room',
            requiredCfm: roomCfm,
            actualLengthFt: roomCfm < 50 ? 12 : roomCfm < 100 ? 18 : roomCfm < 150 ? 25 : roomCfm < 200 ? 30 : roomCfm < 300 ? 35 : 40,
            fittings: [
              { type: 'takeoff_round' as FittingType, qty: 1 },
              { type: 'elbow_90' as FittingType, qty: 1 },
              { type: 'register_boot' as FittingType, qty: 1 },
            ],
          };
        });

        if (imported.length > 0) {
          setEquipmentCfm(systemCfm);
          setRooms(imported);
          setResult(null);
        }
      } else if (inputsRaw) {
        // Fallback: use room inputs (no results available)
        const data = JSON.parse(inputsRaw);
        if (!data.rooms || !Array.isArray(data.rooms)) {
          alert('Invalid Manual J data format.');
          return;
        }

        // Estimate CFM from room area and assume ~1 CFM per sq ft as rough baseline
        const imported: ManualDRoomInput[] = data.rooms.map((r: any, i: number) => {
          const area = (r.lengthFt || 12) * (r.widthFt || 10);
          const estimatedCfm = Math.round(area * 1.0); // ~1 CFM/sqft baseline

          return {
            roomId: uid(),
            roomName: r.name || `Room ${i + 1}`,
            requiredCfm: estimatedCfm,
            actualLengthFt: 25,
            fittings: [
              { type: 'takeoff_round' as FittingType, qty: 1 },
              { type: 'elbow_90' as FittingType, qty: 1 },
              { type: 'register_boot' as FittingType, qty: 1 },
            ],
          };
        });

        if (imported.length > 0) {
          setRooms(imported);
          setResult(null);
        }
      }
    } catch { alert('Failed to parse Manual J data.'); }
  }, []);

  const runCalculation = useCallback(() => {
    const input: ManualDSystemInput = {
      systemName: activeProjectName || 'Manual D Design',
      equipmentCfm,
      blowerEspInwg: blowerEsp,
      filterDropInwg: filterDrop,
      coilDropInwg: coilDrop,
      ductMaterial,
      preferredShape,
      maxAspectRatio,
      application,
      rooms,
    };
    const res = calculateManualD(input);
    setResult(res);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [activeProjectName, equipmentCfm, blowerEsp, filterDrop, coilDrop, ductMaterial, preferredShape, maxAspectRatio, application, rooms]);

  const resetAll = useCallback(() => {
    setApplication('residential');
    setEquipmentCfm(1200);
    setBlowerEsp(0.5);
    setFilterDrop(0.1);
    setCoilDrop(0.2);
    setDuctMaterial('sheet_metal');
    setPreferredShape('round');
    setMaxAspectRatio(4);
    setRooms([createDefaultRoom(0)]);
    setResult(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const exportPdf = useCallback(() => {
    alert('PDF export coming soon. Results are available on-screen for now.');
  }, []);

  const applyToCad = useCallback(() => {
    if (!result) { alert('Run a calculation first.'); return; }
    const cad = useCadStore.getState();
    let updated = 0;
    for (const run of result.runs) {
      const segs = cad.floors.flatMap(f => (f.ductSegments ?? []).filter(d => d.roomId === run.roomId));
      for (const seg of segs) {
        cad.updateDuctSegment(seg.id, {
          diameterIn: run.diameterIn,
          widthIn: run.widthIn,
          heightIn: run.heightIn,
          cfm: run.requiredCfm,
          velocityFpm: run.velocityFpm,
          pressureDropInwg: run.pressureDropInwg,
          frictionRateInwg100: run.frictionRateInwg100,
        });
        updated++;
      }
    }
    cad.markDirty();
    alert(updated > 0
      ? `Updated ${updated} duct segment(s) in CAD workspace.`
      : 'No matching duct segments found in CAD. Draw ducts in the workspace first.');
  }, [result]);

  const totalFittings = (f: ManualDRoomInput['fittings']) => f.reduce((s, x) => s + x.qty, 0);

  return (
    <div className="h-full overflow-y-auto -webkit-overflow-scrolling-touch">
      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">

        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <GitBranch className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">
              {activeProjectName ? `${activeProjectName} — Manual D` : 'Manual D Calculator'}
            </h2>
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg animate-in fade-in duration-300">
                Inputs saved
              </span>
            )}
          </div>
          <p className="text-slate-400 ml-14">
            ACCA Manual D — residential & light commercial duct design and sizing.
          </p>
        </header>

        {/* ═══ System Configuration ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-violet-400" />
            System Configuration
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <NumField label="Equipment CFM" value={equipmentCfm} onChange={setEquipmentCfm} />
            <NumField label="Blower External SP (inwg)" value={blowerEsp} onChange={setBlowerEsp} step={0.01} />
            <NumField label="Filter Pressure Drop (inwg)" value={filterDrop} onChange={setFilterDrop} step={0.01} />
            <NumField label="Coil Pressure Drop (inwg)" value={coilDrop} onChange={setCoilDrop} step={0.01} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Duct Material</label>
              <select value={ductMaterial} onChange={e => setDuctMaterial(e.target.value as DuctMaterial)}
                className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]">
                {MATERIAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Preferred Shape</label>
              <div className="flex gap-2">
                {(['round', 'rectangular', 'oval'] as DuctShape[]).map(s => (
                  <button key={s} onClick={() => setPreferredShape(s)}
                    className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all capitalize ${preferredShape === s ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                    {s === 'rectangular' ? 'Rect' : s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Max Aspect Ratio ({maxAspectRatio}:1)
              </label>
              <input type="range" min={2} max={6} step={1} value={maxAspectRatio}
                onChange={e => setMaxAspectRatio(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 mt-3" />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>2:1</span><span>4:1</span><span>6:1</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Application</label>
              <div className="flex gap-2">
                <button onClick={() => setApplication('residential')}
                  className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${application === 'residential' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                  Residential
                </button>
                <button onClick={() => setApplication('commercial')}
                  className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${application === 'commercial' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                  Commercial
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Room / Run Table ═══ */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Wind className="w-5 h-5 text-sky-400" />
              Duct Runs
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={importFromManualJ}
                className="text-sm font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                Import from Manual J
              </button>
              <button onClick={addRoom}
                className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Room
              </button>
            </div>
          </div>

          <div className="glass-panel rounded-3xl border border-slate-800/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/60 text-slate-400 uppercase text-xs tracking-wider">
                    <th className="text-left p-4 font-semibold">Room Name</th>
                    <th className="text-right p-4 font-semibold">CFM</th>
                    <th className="text-right p-4 font-semibold">Length (ft)</th>
                    <th className="text-center p-4 font-semibold">Fittings</th>
                    {result && (
                      <>
                        <th className="text-right p-4 font-semibold">Total EL (ft)</th>
                        <th className="text-right p-4 font-semibold">Duct Size</th>
                        <th className="text-right p-4 font-semibold">Velocity</th>
                        <th className="text-right p-4 font-semibold">Pressure Drop</th>
                        <th className="text-center p-4 font-semibold">Critical</th>
                      </>
                    )}
                    <th className="p-4 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => {
                    const run = result?.runs.find(r => r.roomId === room.roomId);
                    return (
                      <tr key={room.roomId} className={`border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors ${run?.isCriticalPath ? 'bg-amber-500/5' : ''}`}>
                        <td className="p-3">
                          <input type="text" value={room.roomName}
                            onChange={e => updateRoom(room.roomId, { roomName: e.target.value })}
                            className="w-full bg-transparent border-b border-slate-700/50 text-white font-semibold text-sm py-1 focus:outline-none focus:border-emerald-500/60 transition-colors" />
                        </td>
                        <td className="p-3">
                          <input type="number" value={room.requiredCfm}
                            onChange={e => updateRoom(room.roomId, { requiredCfm: Number(e.target.value) })}
                            className="w-20 bg-transparent border-b border-slate-700/50 text-right text-emerald-400 font-mono text-sm py-1 focus:outline-none focus:border-emerald-500/60 transition-colors" />
                        </td>
                        <td className="p-3">
                          <input type="number" value={room.actualLengthFt}
                            onChange={e => updateRoom(room.roomId, { actualLengthFt: Number(e.target.value) })}
                            className="w-20 bg-transparent border-b border-slate-700/50 text-right text-white font-mono text-sm py-1 focus:outline-none focus:border-emerald-500/60 transition-colors" />
                        </td>
                        <td className="p-3 text-center relative">
                          <button onClick={() => setFittingEditorId(fittingEditorId === room.roomId ? null : room.roomId)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-slate-300 text-xs font-bold hover:border-slate-600 transition-colors">
                            {totalFittings(room.fittings)} <ChevronDown className="w-3 h-3" />
                          </button>
                          {fittingEditorId === room.roomId && (
                            <FittingEditor
                              fittings={room.fittings}
                              onChange={fittings => updateRoom(room.roomId, { fittings })}
                              onClose={() => setFittingEditorId(null)}
                            />
                          )}
                        </td>
                        {run && (
                          <>
                            <td className="p-3 text-right text-slate-300 font-mono text-sm">{run.totalEquivLengthFt}</td>
                            <td className="p-3 text-right text-sky-400 font-mono text-sm whitespace-nowrap">
                              {run.diameterIn != null
                                ? `${run.diameterIn}" rd`
                                : run.widthIn != null && run.heightIn != null
                                  ? `${run.widthIn}"x${run.heightIn}"`
                                  : `${run.equivalentDiameterIn}" eq`}
                            </td>
                            <td className="p-3 text-right font-mono text-sm">
                              <span className={run.velocityFpm > (application === 'residential' ? 900 : 1500) ? 'text-amber-400' : 'text-slate-300'}>
                                {run.velocityFpm} fpm
                              </span>
                            </td>
                            <td className="p-3 text-right text-slate-300 font-mono text-sm">{run.pressureDropInwg.toFixed(4)}</td>
                            <td className="p-3 text-center">
                              {run.isCriticalPath && (
                                <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-bold">
                                  <AlertTriangle className="w-3.5 h-3.5" /> CP
                                </span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="p-3">
                          <button onClick={() => removeRoom(room.roomId)}
                            disabled={rooms.length <= 1}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Per-run warnings */}
            {result && result.runs.some(r => r.warnings.length > 0) && (
              <div className="p-4 border-t border-slate-800/60 space-y-1">
                {result.runs.filter(r => r.warnings.length > 0).map(r => (
                  r.warnings.map((w, wi) => (
                    <p key={`${r.roomId}-${wi}`} className="text-xs text-amber-400 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span><span className="font-bold">{r.roomName}:</span> {w}</span>
                    </p>
                  ))
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mb-10">
          <button onClick={runCalculation}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-base sm:text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3 min-h-[48px]">
            Calculate Duct Sizing <ArrowRight className="w-5 h-5" />
          </button>
          <button onClick={resetAll}
            className="py-4 px-6 rounded-2xl bg-slate-800 text-slate-400 font-bold hover:text-white transition-colors flex items-center justify-center gap-2 min-h-[48px]">
            <RotateCcw className="w-5 h-5" /> Reset
          </button>
        </div>

        {/* ═══ Results ═══ */}
        {result && (
          <section ref={resultsRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard label="Available Static Pressure" value={`${result.availableSpInwg}`} unit="inwg"
                sub={`${blowerEsp} - ${filterDrop} - ${coilDrop}`}
                color="violet" icon={<Gauge className="w-5 h-5" />} />
              <SummaryCard label="Design Friction Rate" value={`${result.designFrictionRate.toFixed(4)}`} unit="inwg/100ft"
                sub="Per critical path"
                color="sky" icon={<Wind className="w-5 h-5" />} />
              <SummaryCard label="Total System CFM" value={`${result.totalSystemCfm.toLocaleString()}`} unit="CFM"
                sub={`${result.runs.length} runs`}
                color="emerald" icon={<GitBranch className="w-5 h-5" />} />
              <SummaryCard label="System Balance" value={result.isBalanced ? 'Balanced' : 'Needs Balancing'}
                sub={`CP: ${result.criticalPathLength} ft TEL`}
                color={result.isBalanced ? 'emerald' : 'orange'}
                icon={result.isBalanced ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />} />
            </div>

            {/* Detail Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <MiniStat label="Critical Path Length" value={`${result.criticalPathLength} ft TEL`} />
              <MiniStat label="Critical Path Pressure Drop" value={`${result.criticalPathPressureDrop.toFixed(4)} inwg`} />
              <MiniStat label="Duct Material" value={MATERIAL_OPTIONS.find(m => m[0] === ductMaterial)?.[1] ?? ductMaterial} />
            </div>

            {/* Balancing Notes */}
            {result.balancingNotes.length > 0 && (
              <div className="glass-panel rounded-2xl border border-slate-800/60 p-5">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-400" />
                  Balancing Notes
                </h4>
                <ul className="space-y-2">
                  {result.balancingNotes.map((note, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${note.includes('ERROR') || note.includes('exceeds') ? 'bg-red-400' : note.includes('balanced') || note.includes('Verify') ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button onClick={applyToCad}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all min-h-[44px]">
                <ArrowRight className="w-4 h-4" /> Apply to CAD
              </button>
              <button onClick={exportPdf}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-semibold text-sm hover:bg-sky-500/20 hover:border-sky-500/50 transition-all min-h-[44px]">
                <ArrowRight className="w-4 h-4" /> Export PDF
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Mason AI Assistant */}
      <Mason context="manual-d" position="bottom-left" />
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</label>
      <input type="number" value={value} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]" />
    </div>
  );
}

function SummaryCard({ label, value, sub, color, icon, unit }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode; unit?: string }) {
  const colors: Record<string, string> = {
    orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  };
  const c = colors[color] ?? colors.emerald;
  return (
    <div className="glass-panel rounded-2xl border border-slate-800/60 p-5">
      <div className={`inline-flex p-2 rounded-xl border mb-3 ${c}`}>{icon}</div>
      <p className="text-xs text-slate-400 font-semibold mb-1">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
      {unit && <p className="text-xs text-slate-500">{unit}</p>}
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel rounded-xl border border-slate-800/60 p-4">
      <p className="text-xs text-slate-500 font-semibold mb-1">{label}</p>
      <p className="text-sm font-bold text-white font-mono">{value}</p>
    </div>
  );
}

function FittingEditor({ fittings, onChange, onClose }: {
  fittings: { type: FittingType; qty: number }[];
  onChange: (f: { type: FittingType; qty: number }[]) => void;
  onClose: () => void;
}) {
  const addFitting = (type: FittingType) => {
    const existing = fittings.find(f => f.type === type);
    if (existing) {
      onChange(fittings.map(f => f.type === type ? { ...f, qty: f.qty + 1 } : f));
    } else {
      onChange([...fittings, { type, qty: 1 }]);
    }
  };

  const removeFitting = (type: FittingType) => {
    const existing = fittings.find(f => f.type === type);
    if (!existing) return;
    if (existing.qty <= 1) {
      onChange(fittings.filter(f => f.type !== type));
    } else {
      onChange(fittings.map(f => f.type === type ? { ...f, qty: f.qty - 1 } : f));
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 top-full mt-1 right-0 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Edit Fittings</h4>

        {/* Current fittings */}
        {fittings.length > 0 && (
          <div className="space-y-1.5 mb-3 pb-3 border-b border-slate-800">
            {fittings.map(f => {
              const opt = FITTING_OPTIONS.find(o => o.value === f.type);
              return (
                <div key={f.type} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{opt?.label ?? f.type}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => removeFitting(f.type)}
                      className="w-6 h-6 rounded bg-slate-800 text-slate-400 hover:text-red-400 text-xs font-bold flex items-center justify-center transition-colors">-</button>
                    <span className="w-6 text-center text-white font-bold">{f.qty}</span>
                    <button onClick={() => addFitting(f.type)}
                      className="w-6 h-6 rounded bg-slate-800 text-slate-400 hover:text-emerald-400 text-xs font-bold flex items-center justify-center transition-colors">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add new fitting */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Add Fitting</p>
          <div className="grid grid-cols-2 gap-1">
            {FITTING_OPTIONS.filter(o => !fittings.some(f => f.type === o.value)).map(opt => (
              <button key={opt.value} onClick={() => addFitting(opt.value)}
                className="text-left text-[11px] text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/5 px-2 py-1.5 rounded-lg transition-colors truncate">
                + {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose}
          className="mt-3 w-full py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-colors">
          Done
        </button>
      </div>
    </>
  );
}
