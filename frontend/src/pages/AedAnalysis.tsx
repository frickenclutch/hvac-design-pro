import { useState, useRef, useEffect } from 'react';
import { Sun, AlertTriangle, CheckCircle, FileDown, Printer, BarChart3, PenTool, Thermometer } from 'lucide-react';
import { calculateAed, extractGlassGroups, type GlassGroup, type AedResult } from '../engines/aed';
import { type Exposure, roundForDisplay } from '../engines/manualJ';
import ProjectContextBar from '../components/ProjectContextBar';
import ProjectGateDialog from '../components/ProjectGateDialog';
import Mason from '../components/Mason';
import { useProjectStore } from '../stores/useProjectStore';
import { useCadStore } from '../features/cad/store/useCadStore';
import { toast } from '../stores/useToastStore';

// ── Display formatting ──────────────────────────────────────────────────────
function fmt(value: number): string {
  return roundForDisplay(value).toLocaleString();
}

// ── Persistence (project-scoped, ACCA-compliant isolation) ──────────────────
function getInputsKey(projectId: string | null): string {
  return `hvac_aed_inputs_${projectId || 'draft'}`;
}
function getResultsKey(projectId: string | null): string {
  return `hvac_aed_results_${projectId || 'draft'}`;
}
function getMjResultsKey(projectId: string | null): string {
  return `hvac_manualj_results_${projectId || 'draft'}`;
}

function loadSavedInputs(projectId: string | null): GlassGroup[] | null {
  try {
    const raw = localStorage.getItem(getInputsKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveInputs(projectId: string | null, groups: GlassGroup[]) {
  try {
    localStorage.setItem(getInputsKey(projectId), JSON.stringify(groups));
  } catch { /* storage full */ }
}

function saveResults(projectId: string | null, result: AedResult) {
  try {
    localStorage.setItem(getResultsKey(projectId), JSON.stringify(result));
    // Also patch the Manual J results (if present) with fresh AED summary
    // so Manual D / PDF export always see the latest AED status.
    const mjKey = getMjResultsKey(projectId);
    const mjRaw = localStorage.getItem(mjKey);
    if (mjRaw) {
      const mj = JSON.parse(mjRaw);
      mj.aed = {
        peakLoad: result.peakLoad,
        averageLoad: result.averageLoad,
        ratio: result.ratio,
        excursion: result.excursion,
        pass: result.pass,
        peakHour: result.peakHour,
      };
      localStorage.setItem(mjKey, JSON.stringify(mj));
    }
  } catch { /* storage full */ }
}

// ── Default glass groups ────────────────────────────────────────────────────
const ORIENTATIONS: Exposure[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

function createDefaultGroups(): GlassGroup[] {
  return [
    { orientation: 'S', areaSqFt: 64, shgc: 0.25, interiorShading: 0.7 },
    { orientation: 'W', areaSqFt: 24, shgc: 0.25, interiorShading: 0.7 },
    { orientation: 'E', areaSqFt: 18, shgc: 0.25, interiorShading: 0.7 },
    { orientation: 'N', areaSqFt: 12, shgc: 0.25, interiorShading: 0.7 },
  ];
}

// ── Auto-import from Manual J data ──────────────────────────────────────────
function tryImportFromManualJ(projectId: string | null): GlassGroup[] | null {
  try {
    const mjKey = `hvac_manualj_inputs_${projectId || 'draft'}`;
    const raw = localStorage.getItem(mjKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.rooms || !Array.isArray(data.rooms)) return null;
    const groups = extractGlassGroups(data.rooms);
    return groups.length > 0 ? groups : null;
  } catch { return null; }
}

// ── Auto-import directly from CAD (windows placed on walls) ─────────────────
// Bypasses Manual J — useful when the user has drawn geometry but not yet filled
// out the load calculator. Aggregates window openings by orientation (wall facing
// is estimated from wall geometry angle; defaults to S if ambiguous).
function tryImportFromCad(): GlassGroup[] | null {
  try {
    const cadStore = useCadStore.getState();
    const allOpenings: Array<{ area: number; shgc: number; orientation: Exposure }> = [];

    for (const floor of cadStore.floors) {
      for (const opening of floor.openings) {
        if (opening.type !== 'window') continue; // doors excluded
        const areaFt2 = (opening.widthIn * opening.heightIn) / 144;
        if (areaFt2 <= 0) continue;

        // Estimate orientation from parent wall's geometry angle
        const wall = floor.walls.find(w => w.id === opening.wallId);
        let orientation: Exposure = 'S'; // default fallback
        if (wall) {
          const dx = wall.x2 - wall.x1;
          const dy = wall.y2 - wall.y1;
          // Wall faces perpendicular to its length. Convert to compass bearing.
          // Canvas Y increases downward; negate to get math convention.
          const angleDeg = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
          // Rotate 90° to get the wall's outward normal (assume exterior is "right" of wall)
          const bearing = (angleDeg + 90) % 360;
          // Map to 8-point compass
          if (bearing >= 337.5 || bearing < 22.5) orientation = 'E';
          else if (bearing < 67.5) orientation = 'NE';
          else if (bearing < 112.5) orientation = 'N';
          else if (bearing < 157.5) orientation = 'NW';
          else if (bearing < 202.5) orientation = 'W';
          else if (bearing < 247.5) orientation = 'SW';
          else if (bearing < 292.5) orientation = 'S';
          else orientation = 'SE';
        }

        allOpenings.push({
          area: areaFt2,
          shgc: opening.shgc ?? 0.25, // default to Low-E double-pane
          orientation,
        });
      }
    }

    if (allOpenings.length === 0) return null;

    // Aggregate by orientation + SHGC
    const map = new Map<string, GlassGroup>();
    for (const o of allOpenings) {
      const key = `${o.orientation}_${o.shgc}`;
      const existing = map.get(key);
      if (existing) {
        existing.areaSqFt += o.area;
      } else {
        map.set(key, {
          orientation: o.orientation,
          areaSqFt: o.area,
          shgc: o.shgc,
          interiorShading: 0.7, // sensible default; user can adjust
        });
      }
    }
    return Array.from(map.values());
  } catch { return null; }
}

// ── Component ───────────────────────────────────────────────────────────────
export default function AedAnalysis() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  // Project gate
  const [gateAccepted, setGateAccepted] = useState(!!activeProjectId);
  const showGate = !activeProjectId && !gateAccepted;

  // Load saved or import from Manual J or use defaults
  const initialGroups = useRef(
    loadSavedInputs(activeProjectId) ??
    tryImportFromManualJ(activeProjectId) ??
    createDefaultGroups()
  ).current;

  const [groups, setGroups] = useState<GlassGroup[]>(initialGroups);
  const [result, setResult] = useState<AedResult | null>(null);
  const isFirstRender = useRef(true);

  // Auto-save on input change
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveInputs(activeProjectId, groups);
  }, [groups, activeProjectId]);

  // Reload on project change
  useEffect(() => {
    const data = loadSavedInputs(activeProjectId) ??
      tryImportFromManualJ(activeProjectId) ??
      createDefaultGroups();
    setGroups(data);
    setResult(null);
    setGateAccepted(!!activeProjectId);
  }, [activeProjectId]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleCalculate = () => {
    const res = calculateAed(groups);
    setResult(res);
    // Persist results + back-patch into Manual J results for cross-tool coherence
    saveResults(activeProjectId, res);
    if (res.excursion > 0) {
      toast.warning(`AED FAIL — excursion penalty ${Math.round(res.excursion).toLocaleString()} BTU/hr added to cooling load`);
    } else {
      toast.success(`AED PASS — ratio ${Math.round(res.ratio * 100 * 10) / 10}% (under 130% threshold)`);
    }
  };

  const handleReset = () => {
    setGroups(createDefaultGroups());
    setResult(null);
    try { localStorage.removeItem(getResultsKey(activeProjectId)); } catch { /* */ }
  };

  const handleImportFromMJ = () => {
    const imported = tryImportFromManualJ(activeProjectId);
    if (imported) {
      setGroups(imported);
      setResult(null);
      toast.success(`Imported ${imported.length} fenestration group${imported.length === 1 ? '' : 's'} from Manual J`);
    } else {
      toast.info('No Manual J window data found for this project. Fill out Manual J first or import from CAD.');
    }
  };

  const handleImportFromCad = () => {
    const imported = tryImportFromCad();
    if (imported) {
      setGroups(imported);
      setResult(null);
      toast.success(`Imported ${imported.length} fenestration group${imported.length === 1 ? '' : 's'} from CAD`);
    } else {
      toast.info('No windows found in CAD. Draw windows on walls first, or use Manual J import.');
    }
  };

  const updateGroup = (index: number, field: keyof GlassGroup, value: number | Exposure) => {
    setGroups(prev => prev.map((g, i) => i === index ? { ...g, [field]: value } : g));
  };

  const addGroup = () => {
    setGroups(prev => [...prev, { orientation: 'S' as Exposure, areaSqFt: 0, shgc: 0.25, interiorShading: 0.7 }]);
  };

  const removeGroup = (index: number) => {
    setGroups(prev => prev.filter((_, i) => i !== index));
  };

  // ── Print ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!result) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>AED Analysis</title>
      <style>body{font-family:system-ui;max-width:800px;margin:40px auto;color:#333}
      table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #ddd;padding:8px;text-align:right}
      th{background:#f5f5f5;text-align:center}.pass{color:#16a34a;font-weight:bold}.fail{color:#dc2626;font-weight:bold}
      .peak{background:#fff3cd}</style></head><body>
      <h1>Adequate Exposure Diversity Analysis</h1>
      <p>Manual J 8th Edition, Section N</p>
      <h2>Results</h2>
      <table><tr><td>Peak Hourly Glass Load</td><td><strong>${fmt(result.peakLoad)} BTU/hr</strong> (${result.hourlyLoads.find(h => h.hour === result.peakHour)?.label})</td></tr>
      <tr><td>12-Hour Average</td><td>${fmt(result.averageLoad)} BTU/hr</td></tr>
      <tr><td>Ratio (Peak / Average)</td><td>${roundForDisplay(result.ratio * 100, 1)}%</td></tr>
      <tr><td>Threshold</td><td>130% maximum</td></tr>
      <tr><td>Status</td><td class="${result.pass ? 'pass' : 'fail'}">${result.pass ? 'PASS' : 'FAIL'}</td></tr>
      ${result.excursion > 0 ? `<tr><td>Excursion Penalty</td><td class="fail">${fmt(result.excursion)} BTU/hr added to cooling load</td></tr>` : ''}
      </table>
      <h2>Hourly Glass Load Distribution</h2>
      <table><thead><tr><th>Hour</th><th>Total (BTU/hr)</th></tr></thead><tbody>
      ${result.hourlyLoads.map(h => `<tr class="${h.hour === result.peakHour ? 'peak' : ''}"><td>${h.label}</td><td>${fmt(h.totalGlassLoad)}</td></tr>`).join('')}
      </tbody></table>
      <p style="color:#888;font-size:12px">Generated: ${new Date().toLocaleString()}</p>
      </body></html>`);
    w.document.close();
    w.print();
  };

  // ── PDF Export ──────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!result) return;
    const { default: JsPDF } = await import('jspdf');
    const doc = new JsPDF({ orientation: 'portrait', format: 'letter' });
    const pw = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 50;

    // Title
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('AED Analysis — Manual J Section N', pw / 2, y, { align: 'center' }); y += 30;

    // Status badge
    doc.setFontSize(14);
    if (result.pass) {
      doc.setTextColor(22, 163, 74);
      doc.text('PASS', pw / 2, y, { align: 'center' });
    } else {
      doc.setTextColor(220, 38, 38);
      doc.text('FAIL', pw / 2, y, { align: 'center' });
    }
    y += 25;

    // Summary
    doc.setTextColor(0); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    const summaryLines = [
      [`Peak Hourly Glass Load:`, `${fmt(result.peakLoad)} BTU/hr (${result.hourlyLoads.find(h => h.hour === result.peakHour)?.label})`],
      [`12-Hour Average:`, `${fmt(result.averageLoad)} BTU/hr`],
      [`Ratio (Peak/Average):`, `${roundForDisplay(result.ratio * 100, 1)}% (max 130%)`],
    ];
    if (result.excursion > 0) {
      summaryLines.push([`Excursion Penalty:`, `${fmt(result.excursion)} BTU/hr added to cooling load`]);
    }
    for (const [label, val] of summaryLines) {
      doc.setFont('helvetica', 'normal'); doc.text(label, margin, y);
      doc.setFont('helvetica', 'bold'); doc.text(val, margin + 200, y);
      y += 16;
    }
    y += 10;

    // Hourly table
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Hourly Glass Load Distribution', margin, y); y += 16;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('Hour', margin, y);
    doc.text('Total (BTU/hr)', margin + 200, y, { align: 'right' });
    y += 4;
    doc.setDrawColor(180); doc.line(margin, y, pw - margin, y); y += 12;

    doc.setFont('helvetica', 'normal');
    for (const h of result.hourlyLoads) {
      const isPeak = h.hour === result.peakHour;
      if (isPeak) doc.setFont('helvetica', 'bold');
      doc.text(h.label, margin, y);
      doc.text(fmt(h.totalGlassLoad), margin + 200, y, { align: 'right' });
      if (isPeak) { doc.text(' <-- PEAK', margin + 210, y); doc.setFont('helvetica', 'normal'); }
      y += 14;
    }

    doc.save(`AED_Analysis_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {showGate && (
        <ProjectGateDialog
          onProjectSelected={() => setGateAccepted(true)}
          onDraft={() => setGateAccepted(true)}
        />
      )}
      <ProjectContextBar />

      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Sun className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AED Analysis</h1>
            <p className="text-sm text-slate-400">Adequate Exposure Diversity — Manual J Section N</p>
          </div>
        </div>

        {/* Glass Groups Input */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Fenestration Groups</h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleImportFromCad}
                title="Auto-populate from windows drawn in the CAD workspace"
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-colors min-h-[44px]">
                <PenTool className="w-3.5 h-3.5" /> Import from CAD
              </button>
              <button onClick={handleImportFromMJ}
                title="Auto-populate from Manual J room window data"
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 transition-colors min-h-[44px]">
                <Thermometer className="w-3.5 h-3.5" /> Import from Manual J
              </button>
              <button onClick={addGroup}
                className="px-3 py-2 text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors min-h-[44px]">
                + Add Group
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left p-2 text-slate-400 font-medium">Orientation</th>
                  <th className="text-right p-2 text-slate-400 font-medium">Area (ft²)</th>
                  <th className="text-right p-2 text-slate-400 font-medium">SHGC</th>
                  <th className="text-right p-2 text-slate-400 font-medium">Shading (IAC)</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i} className="border-b border-slate-800/30">
                    <td className="p-2">
                      <select value={g.orientation} onChange={e => updateGroup(i, 'orientation', e.target.value as Exposure)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 min-h-[44px] w-full">
                        {ORIENTATIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <input type="number" value={g.areaSqFt} min={0} step={1}
                        onChange={e => updateGroup(i, 'areaSqFt', Number(e.target.value))}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-right text-slate-100 min-h-[44px] w-full" />
                    </td>
                    <td className="p-2">
                      <input type="number" value={g.shgc} min={0} max={1} step={0.01}
                        onChange={e => updateGroup(i, 'shgc', Number(e.target.value))}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-right text-slate-100 min-h-[44px] w-full" />
                    </td>
                    <td className="p-2">
                      <input type="number" value={g.interiorShading} min={0} max={1} step={0.05}
                        onChange={e => updateGroup(i, 'interiorShading', Number(e.target.value))}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-right text-slate-100 min-h-[44px] w-full" />
                    </td>
                    <td className="p-2">
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(i)}
                          className="p-2 text-red-400 hover:text-red-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button onClick={handleCalculate}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:brightness-110 transition-all min-h-[44px]">
            <BarChart3 className="w-4 h-4" /> Run AED Check
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-medium text-sm hover:bg-slate-700 transition-all min-h-[44px]">
            Reset
          </button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Pass/Fail Banner */}
            <div className={`glass-panel rounded-2xl p-5 border ${result.pass ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
              <div className="flex items-center gap-3 mb-4">
                {result.pass
                  ? <CheckCircle className="w-6 h-6 text-emerald-400" />
                  : <AlertTriangle className="w-6 h-6 text-red-400" />
                }
                <span className={`text-lg font-bold ${result.pass ? 'text-emerald-400' : 'text-red-400'}`}>
                  AED {result.pass ? 'PASS' : 'FAIL'} — {roundForDisplay(result.ratio * 100, 1)}%
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Peak Hourly Load</div>
                  <div className="text-lg font-bold text-white font-mono">{fmt(result.peakLoad)} <span className="text-xs text-slate-400">BTU/hr</span></div>
                  <div className="text-xs text-slate-500">{result.hourlyLoads.find(h => h.hour === result.peakHour)?.label}</div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">12-Hour Average</div>
                  <div className="text-lg font-bold text-white font-mono">{fmt(result.averageLoad)} <span className="text-xs text-slate-400">BTU/hr</span></div>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Excursion Penalty</div>
                  <div className={`text-lg font-bold font-mono ${result.excursion > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {result.excursion > 0 ? `+${fmt(result.excursion)}` : '0'} <span className="text-xs text-slate-400">BTU/hr</span>
                  </div>
                </div>
              </div>

              {!result.pass && (
                <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
                  AED failure indicates uneven solar loading. Consider zoned systems, VAV devices, or motorized dampers to balance exposure.
                </div>
              )}
            </div>

            {/* Hourly Bar Chart */}
            <div className="glass-panel rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Hourly Glass Load Distribution</h3>
              <div className="space-y-2">
                {result.hourlyLoads.map(h => {
                  const maxLoad = result.peakLoad || 1;
                  const pct = (h.totalGlassLoad / maxLoad) * 100;
                  const isPeak = h.hour === result.peakHour;
                  return (
                    <div key={h.hour} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-12 text-right font-mono">{h.label}</span>
                      <div className="flex-1 h-6 bg-slate-800/50 rounded-md overflow-hidden">
                        <div
                          className={`h-full rounded-md transition-all ${isPeak ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gradient-to-r from-amber-500/60 to-amber-400/40'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono w-20 text-right ${isPeak ? 'text-orange-400 font-bold' : 'text-slate-400'}`}>
                        {fmt(h.totalGlassLoad)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <div className="w-3 h-3 rounded bg-gradient-to-r from-orange-500 to-red-500" />
                <span>Peak hour</span>
                <div className="w-3 h-3 rounded bg-gradient-to-r from-amber-500/60 to-amber-400/40 ml-3" />
                <span>Normal hours</span>
                <span className="ml-auto">Threshold: 130% of average (dashed)</span>
              </div>
            </div>

            {/* Export/Print */}
            <div className="flex gap-3 justify-end">
              <button onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm hover:bg-slate-700 transition-all min-h-[44px]">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button onClick={handleExportPdf}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm hover:bg-emerald-500/20 transition-all min-h-[44px]">
                <FileDown className="w-4 h-4" /> Export PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mason — AI HVAC Assistant (AED context) */}
      <Mason context="aed" />
    </div>
  );
}
