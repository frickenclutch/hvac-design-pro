import { useState, useRef, useEffect, useCallback } from 'react';
import {
  PackageCheck, Snowflake, Flame, Gauge, ArrowRight, RotateCcw,
  AlertTriangle, CheckCircle, Info, Mountain, PackageSearch,
} from 'lucide-react';
import {
  calculateManualS, coolingStatusLabel, heatingStatusLabel,
  type ManualSInput, type ManualSResult,
  type CoolingSystemType, type HeatingSystemType,
  type CoolingStatus, type HeatingStatus,
} from '../engines/manualS';
import {
  manualJToManualS, suggestCoolingEquipment, suggestHeatingEquipment,
} from '../engines/manualJToManualS';
import type { WholeHouseResult, DesignConditions } from '../engines/manualJ';
import { useProjectStore } from '../stores/useProjectStore';
import Mason from '../components/Mason';
import ProjectContextBar from '../components/ProjectContextBar';
import ProjectGateDialog from '../components/ProjectGateDialog';
import CatalogPickerModal from '../components/CatalogPickerModal';
import type { ApiCatalogProductRow } from '../lib/api';
import { scopedKey } from '../utils/storage';
import { syncCalcToD1 } from '../features/calculations/calcStorage';

// ── User + project scoped persistence ────────────────────────────────────────
function getStorageKey(projectId: string | null): string {
  return scopedKey(`hvac_manuals_inputs_${projectId || 'draft'}`);
}
function getMjResultsKey(projectId: string | null): string {
  return scopedKey(`hvac_manualj_results_${projectId || 'draft'}`);
}
function getMjInputsKey(projectId: string | null): string {
  return scopedKey(`hvac_manualj_inputs_${projectId || 'draft'}`);
}

// One-time migration of any pre-scoping global key
(function migrateGlobalKeys() {
  try {
    const old = localStorage.getItem('hvac_manuals_inputs');
    if (old && !localStorage.getItem('hvac_manuals_inputs_draft')) {
      localStorage.setItem('hvac_manuals_inputs_draft', old);
    }
  } catch { /* ignore */ }
})();

type LoadsSource = 'manual' | 'manual-j';

type SavedState = {
  loadsSource: LoadsSource;
  totalCoolingBtu: number;
  sensibleCoolingBtu: number;
  heatingBtu: number;
  outdoorCoolingTempF: number;
  outdoorHeatingTempF: number;
  indoorCoolingTempF: number;
  elevationFt: number;
  coolingType: CoolingSystemType;
  coolingModel: string;
  ahriRef: string;
  coolTotalCap: number;
  coolSensCap: number;
  applyAltitude: boolean;
  heatingType: HeatingSystemType;
  heatingModel: string;
  heatCap: number;
  cap47: number;
  cap17: number;
  afue: number;
};

function defaultState(): SavedState {
  return {
    loadsSource: 'manual',
    totalCoolingBtu: 36000,
    sensibleCoolingBtu: 27000,
    heatingBtu: 45000,
    outdoorCoolingTempF: 95,
    outdoorHeatingTempF: 5,
    indoorCoolingTempF: 75,
    elevationFt: 0,
    coolingType: 'ac',
    coolingModel: '',
    ahriRef: '',
    coolTotalCap: 38000,
    coolSensCap: 28000,
    applyAltitude: false,
    heatingType: 'furnace_gas',
    heatingModel: '',
    heatCap: 50000,
    cap47: 0,
    cap17: 0,
    afue: 0,
  };
}

function loadSaved(projectId: string | null): SavedState | null {
  try { const r = localStorage.getItem(getStorageKey(projectId)); return r ? { ...defaultState(), ...JSON.parse(r) } : null; } catch { return null; }
}
function saveState(projectId: string | null, s: SavedState) {
  try { localStorage.setItem(getStorageKey(projectId), JSON.stringify(s)); } catch { /* storage full */ }
}

const COOLING_TYPES: [CoolingSystemType, string][] = [
  ['ac', 'Air Conditioner'],
  ['heat_pump', 'Heat Pump'],
];
const HEATING_TYPES: [HeatingSystemType, string][] = [
  ['furnace_gas', 'Gas Furnace'],
  ['furnace_electric', 'Electric Furnace'],
  ['heat_pump', 'Heat Pump'],
  ['none', 'None (Cooling Only)'],
];

// Verdict colour tones keyed off the engine status enums.
function coolingTone(status: CoolingStatus): 'emerald' | 'red' | 'slate' {
  if (status === 'pass') return 'emerald';
  if (status === 'no_load') return 'slate';
  return 'red';
}
function heatingTone(status: HeatingStatus): 'emerald' | 'amber' | 'red' | 'slate' {
  if (status === 'pass') return 'emerald';
  if (status === 'aux_required') return 'amber';
  if (status === 'no_load' || status === 'no_equipment') return 'slate';
  return 'red';
}

export default function ManualSCalculator() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProjectName = useProjectStore((s) => s.activeProjectName);

  // Project gate
  const [gateAccepted, setGateAccepted] = useState(!!activeProjectId);
  const showGate = !activeProjectId && !gateAccepted;

  const saved = useRef(loadSaved(activeProjectId) ?? defaultState()).current;

  // Design loads
  const [loadsSource, setLoadsSource] = useState<LoadsSource>(saved.loadsSource);
  const [totalCoolingBtu, setTotalCoolingBtu] = useState(saved.totalCoolingBtu);
  const [sensibleCoolingBtu, setSensibleCoolingBtu] = useState(saved.sensibleCoolingBtu);
  const [heatingBtu, setHeatingBtu] = useState(saved.heatingBtu);
  const [outdoorCoolingTempF, setOutdoorCoolingTempF] = useState(saved.outdoorCoolingTempF);
  const [outdoorHeatingTempF, setOutdoorHeatingTempF] = useState(saved.outdoorHeatingTempF);
  const [indoorCoolingTempF, setIndoorCoolingTempF] = useState(saved.indoorCoolingTempF);
  const [elevationFt, setElevationFt] = useState(saved.elevationFt);

  // Cooling equipment
  const [coolingType, setCoolingType] = useState<CoolingSystemType>(saved.coolingType);
  const [coolingModel, setCoolingModel] = useState(saved.coolingModel);
  const [ahriRef, setAhriRef] = useState(saved.ahriRef);
  const [coolTotalCap, setCoolTotalCap] = useState(saved.coolTotalCap);
  const [coolSensCap, setCoolSensCap] = useState(saved.coolSensCap);
  const [applyAltitude, setApplyAltitude] = useState(saved.applyAltitude);

  // Heating equipment
  const [heatingType, setHeatingType] = useState<HeatingSystemType>(saved.heatingType);
  const [heatingModel, setHeatingModel] = useState(saved.heatingModel);
  const [heatCap, setHeatCap] = useState(saved.heatCap);
  const [cap47, setCap47] = useState(saved.cap47);
  const [cap17, setCap17] = useState(saved.cap17);
  const [afue, setAfue] = useState(saved.afue);

  const [result, setResult] = useState<ManualSResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  // Catalog picker — null when closed, else which equipment block it fills.
  const [pickerMode, setPickerMode] = useState<'cooling' | 'heating' | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const derivedLatent = Math.max(0, totalCoolingBtu - sensibleCoolingBtu);

  // Reload data when the active project changes
  useEffect(() => {
    const data = loadSaved(activeProjectId) ?? defaultState();
    setLoadsSource(data.loadsSource);
    setTotalCoolingBtu(data.totalCoolingBtu);
    setSensibleCoolingBtu(data.sensibleCoolingBtu);
    setHeatingBtu(data.heatingBtu);
    setOutdoorCoolingTempF(data.outdoorCoolingTempF);
    setOutdoorHeatingTempF(data.outdoorHeatingTempF);
    setIndoorCoolingTempF(data.indoorCoolingTempF);
    setElevationFt(data.elevationFt);
    setCoolingType(data.coolingType);
    setCoolingModel(data.coolingModel);
    setAhriRef(data.ahriRef);
    setCoolTotalCap(data.coolTotalCap);
    setCoolSensCap(data.coolSensCap);
    setApplyAltitude(data.applyAltitude);
    setHeatingType(data.heatingType);
    setHeatingModel(data.heatingModel);
    setHeatCap(data.heatCap);
    setCap47(data.cap47);
    setCap17(data.cap17);
    setAfue(data.afue);
    setResult(null);
    setGateAccepted(!!activeProjectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Auto-save (project-scoped) with skip-first-render guard
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    saveState(activeProjectId, {
      loadsSource, totalCoolingBtu, sensibleCoolingBtu, heatingBtu,
      outdoorCoolingTempF, outdoorHeatingTempF, indoorCoolingTempF, elevationFt,
      coolingType, coolingModel, ahriRef, coolTotalCap, coolSensCap, applyAltitude,
      heatingType, heatingModel, heatCap, cap47, cap17, afue,
    });
    setSaveStatus('saved');
    const t = setTimeout(() => setSaveStatus('idle'), 1500);
    return () => clearTimeout(t);
  }, [loadsSource, totalCoolingBtu, sensibleCoolingBtu, heatingBtu,
      outdoorCoolingTempF, outdoorHeatingTempF, indoorCoolingTempF, elevationFt,
      coolingType, coolingModel, ahriRef, coolTotalCap, coolSensCap, applyAltitude,
      heatingType, heatingModel, heatCap, cap47, cap17, afue, activeProjectId]);

  const importFromManualJ = useCallback(() => {
    try {
      const currentProjectId = useProjectStore.getState().activeProjectId;
      const resultsRaw = localStorage.getItem(getMjResultsKey(currentProjectId));
      if (!resultsRaw) {
        alert('No Manual J results found. Run a Manual J calculation first.');
        return;
      }
      const mj = JSON.parse(resultsRaw) as WholeHouseResult;
      if (typeof mj.totalCoolingBtu !== 'number') {
        alert('Invalid Manual J results. Please re-run the Manual J calculation.');
        return;
      }

      let conditions: Partial<DesignConditions> | undefined;
      const inputsRaw = localStorage.getItem(getMjInputsKey(currentProjectId));
      if (inputsRaw) {
        try { conditions = (JSON.parse(inputsRaw) as { conditions?: DesignConditions }).conditions; } catch { /* ignore */ }
      }

      const loads = manualJToManualS(mj, conditions);
      setTotalCoolingBtu(Math.round(loads.totalCoolingBtu));
      setSensibleCoolingBtu(Math.round(loads.sensibleCoolingBtu));
      setHeatingBtu(Math.round(loads.heatingBtu));
      setOutdoorCoolingTempF(loads.outdoorCoolingTempF);
      setOutdoorHeatingTempF(loads.outdoorHeatingTempF);
      setIndoorCoolingTempF(loads.indoorCoolingTempF);
      setElevationFt(loads.elevationFt);

      // Seed neutral starting equipment so the first calc is meaningful.
      const csug = suggestCoolingEquipment(loads, coolingType);
      setCoolTotalCap(csug.totalCoolingCapacityBtu);
      setCoolSensCap(csug.sensibleCoolingCapacityBtu);
      const hsug = suggestHeatingEquipment(loads, heatingType);
      setHeatCap(hsug.heatingCapacityBtu);

      setLoadsSource('manual-j');
      setResult(null);
    } catch { alert('Failed to parse Manual J data.'); }
  }, [coolingType, heatingType]);

  const runCalculation = useCallback(() => {
    const t0 = performance.now();
    const input: ManualSInput = {
      systemName: activeProjectName || 'Manual S Selection',
      loads: {
        totalCoolingBtu,
        sensibleCoolingBtu,
        latentCoolingBtu: Math.max(0, totalCoolingBtu - sensibleCoolingBtu),
        heatingBtu,
        outdoorCoolingTempF,
        outdoorHeatingTempF,
        indoorCoolingTempF,
        elevationFt,
      },
      cooling: {
        systemType: coolingType,
        modelName: coolingModel || undefined,
        ahriRefNumber: ahriRef || undefined,
        totalCoolingCapacityBtu: coolTotalCap,
        sensibleCoolingCapacityBtu: coolSensCap,
        applyAltitudeCorrection: applyAltitude,
      },
      heating: {
        heatingType,
        modelName: heatingModel || undefined,
        heatingCapacityBtu: heatCap,
        heatingCapacityAt47Btu: heatingType === 'heat_pump' && cap47 > 0 ? cap47 : undefined,
        heatingCapacityAt17Btu: heatingType === 'heat_pump' && cap17 > 0 ? cap17 : undefined,
        afue: afue > 0 ? afue : undefined,
      },
    };
    const res = calculateManualS(input);
    const durationMs = Math.round(performance.now() - t0);
    setResult(res);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    // Persist to D1 (append-only, engine-stamped) — fire-and-forget.
    void syncCalcToD1({
      projectId: activeProjectId,
      calcType: 'MANUAL_S',
      inputs: input,
      outputs: res,
      engineVersion: res.engineVersion,
      durationMs,
      method: 'manualS',
    });

    // Back-patch a compact Manual S summary into the Manual J results so the
    // future combined report + cross-tool reads see the latest status.
    try {
      const mjKey = getMjResultsKey(activeProjectId);
      const mjRaw = localStorage.getItem(mjKey);
      if (mjRaw) {
        const mj = JSON.parse(mjRaw) as Record<string, unknown>;
        mj.manualS = {
          coolingStatus: res.cooling.status,
          coolingPass: res.cooling.pass,
          totalSizingPct: res.cooling.totalSizingPct,
          heatingStatus: res.heating.status,
          heatingPass: res.heating.pass,
          supplementalHeatBtu: res.heating.supplementalHeatBtu,
          overallPass: res.overallPass,
          engineVersion: res.engineVersion,
        };
        localStorage.setItem(mjKey, JSON.stringify(mj));
      }
    } catch { /* storage full */ }
  }, [activeProjectId, activeProjectName, totalCoolingBtu, sensibleCoolingBtu, heatingBtu,
      outdoorCoolingTempF, outdoorHeatingTempF, indoorCoolingTempF, elevationFt,
      coolingType, coolingModel, ahriRef, coolTotalCap, coolSensCap, applyAltitude,
      heatingType, heatingModel, heatCap, cap47, cap17, afue]);

  // Map a picked catalog row (category='hvac_equipment') onto the equipment
  // setters. The catalog's equipment_type IS the engine's own discriminator, so
  // this is a near-identity field copy onto CoolingEquipmentInput /
  // HeatingEquipmentInput. A heat_pump fills BOTH blocks (it cools AND heats);
  // an ac fills cooling only; a furnace_* fills heating only.
  const applyCatalogItem = useCallback((row: ApiCatalogProductRow) => {
    const label = row.model || row.name;
    const et = row.equipment_type;

    // Cooling block — only AC and heat pumps cool.
    if (et === 'ac' || et === 'heat_pump') {
      setCoolingType(et === 'heat_pump' ? 'heat_pump' : 'ac');
      setCoolingModel(label);
      setAhriRef(row.ahri_ref ?? '');
      if (row.total_cooling_btu != null) setCoolTotalCap(row.total_cooling_btu);
      if (row.sensible_cooling_btu != null) setCoolSensCap(row.sensible_cooling_btu);
    }

    // Heating block — heat pumps and furnaces heat.
    if (et === 'heat_pump') {
      setHeatingType('heat_pump');
      setHeatingModel(label);
      if (row.heating_btu != null) setHeatCap(row.heating_btu);
      setCap47(row.heating_cap_47 ?? 0);
      setCap17(row.heating_cap_17 ?? 0);
    } else if (et === 'furnace_gas' || et === 'furnace_electric') {
      setHeatingType(et);
      setHeatingModel(label);
      if (row.heating_btu != null) setHeatCap(row.heating_btu);
      if (row.afue != null) setAfue(row.afue);
    }

    // Picking equipment doesn't change the design loads — clear the stale
    // result so the user re-runs against the newly filled equipment.
    setResult(null);
  }, []);

  const resetAll = useCallback(() => {
    const d = defaultState();
    setLoadsSource(d.loadsSource);
    setTotalCoolingBtu(d.totalCoolingBtu);
    setSensibleCoolingBtu(d.sensibleCoolingBtu);
    setHeatingBtu(d.heatingBtu);
    setOutdoorCoolingTempF(d.outdoorCoolingTempF);
    setOutdoorHeatingTempF(d.outdoorHeatingTempF);
    setIndoorCoolingTempF(d.indoorCoolingTempF);
    setElevationFt(d.elevationFt);
    setCoolingType(d.coolingType);
    setCoolingModel(d.coolingModel);
    setAhriRef(d.ahriRef);
    setCoolTotalCap(d.coolTotalCap);
    setCoolSensCap(d.coolSensCap);
    setApplyAltitude(d.applyAltitude);
    setHeatingType(d.heatingType);
    setHeatingModel(d.heatingModel);
    setHeatCap(d.heatCap);
    setCap47(d.cap47);
    setCap17(d.cap17);
    setAfue(d.afue);
    setResult(null);
    localStorage.removeItem(getStorageKey(activeProjectId));
  }, [activeProjectId]);

  const exportPdf = useCallback(async () => {
    if (!result) { alert('Run a calculation first.'); return; }
    const { default: JsPDF } = await import('jspdf');
    const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const margin = 48;
    let y = 56;

    const { cooling: c, heating: h } = result;

    // Title + subtitle
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text('Manual S — Equipment Selection', pw / 2, y, { align: 'center' }); y += 18;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(
      `${activeProjectName || 'Untitled Project'}  ·  ${COOLING_TYPES.find(t => t[0] === coolingType)?.[1]}  ·  ACCA Manual S`,
      pw / 2, y, { align: 'center' },
    );
    y += 22;

    // Overall verdict
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    if (result.overallPass) { doc.setTextColor(16, 150, 100); doc.text('PASS — selection within Manual S limits', margin, y); }
    else { doc.setTextColor(200, 60, 60); doc.text('REVIEW — selection outside Manual S limits', margin, y); }
    y += 20;

    const pairBlock = (title: string, pairs: [string, string][]) => {
      doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(title, margin, y); y += 14;
      doc.setFontSize(9);
      pairs.forEach(([label, val]) => {
        if (y > ph - 60) { doc.addPage(); y = 56; }
        doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.text(label, margin, y);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.text(val, margin + 230, y);
        y += 14;
      });
      y += 8;
    };

    pairBlock('Design Loads (Manual J)', [
      ['Total cooling', `${totalCoolingBtu.toLocaleString()} BTU/h`],
      ['Sensible cooling', `${sensibleCoolingBtu.toLocaleString()} BTU/h`],
      ['Latent cooling', `${derivedLatent.toLocaleString()} BTU/h`],
      ['Heating', `${heatingBtu.toLocaleString()} BTU/h`],
      ['Design temps (cool / heat)', `${outdoorCoolingTempF}°F / ${outdoorHeatingTempF}°F`],
      ['Elevation', `${elevationFt.toLocaleString()} ft`],
    ]);

    pairBlock(`Cooling Equipment — ${coolingStatusLabel(c.status)}`, [
      ...(coolingModel ? [['Model', coolingModel] as [string, string]] : []),
      ...(ahriRef ? [['AHRI ref', ahriRef] as [string, string]] : []),
      ['Total capacity @ design', `${c.totalCapacityBtu.toLocaleString()} BTU/h  (${c.totalSizingPct}%)`],
      ['Sensible capacity @ design', `${c.sensibleCapacityBtu.toLocaleString()} BTU/h  (${c.sensibleSizingPct}%)`],
      ['Latent capacity', `${c.latentCapacityBtu.toLocaleString()} BTU/h  (${c.latentSizingPct}%)`],
      ['Equipment / load SHR', `${c.equipmentShr} / ${c.loadShr}`],
      ...(c.altitudeCorrectionApplied ? [['Altitude derate', `−${c.altitudeDeratePct}% sensible`] as [string, string]] : []),
    ]);

    if (h.status !== 'no_equipment') {
      pairBlock(`Heating Equipment — ${heatingStatusLabel(h.status)}`, [
        ['Type', HEATING_TYPES.find(t => t[0] === h.heatingType)?.[1] ?? h.heatingType],
        ...(heatingModel ? [['Model', heatingModel] as [string, string]] : []),
        ['Capacity', `${h.capacityBtu.toLocaleString()} BTU/h  (${h.sizingPct}%)`],
        ...(h.supplementalHeatBtu > 0 ? [['Supplemental heat', `${h.supplementalHeatBtu.toLocaleString()} BTU/h (${h.supplementalHeatKw} kW)`] as [string, string]] : []),
        ...(h.balancePointF != null ? [['Balance point', `${h.balancePointF}°F`] as [string, string]] : []),
      ]);
    }

    const allWarnings = [...c.warnings, ...h.warnings];
    if (allWarnings.length > 0) {
      doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      if (y > ph - 60) { doc.addPage(); y = 56; }
      doc.text('Warnings', margin, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60);
      for (const w of allWarnings) {
        if (y > ph - 50) { doc.addPage(); y = 56; }
        const lines = doc.splitTextToSize(`•  ${w}`, pw - margin * 2) as string[];
        doc.text(lines, margin, y); y += lines.length * 11;
      }
    }

    // Footer engine stamp (matches AED / Manual D audit-trail style)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(150);
    doc.text(`Engine ${result.engineVersion}  —  ACCA Manual S (Equipment Selection)`, margin, ph - 24);
    doc.text(new Date().toISOString().slice(0, 10), pw - margin, ph - 24, { align: 'right' });

    const safeName = (activeProjectName || 'Manual_S').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    doc.save(`ManualS_EquipmentSelection_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [result, activeProjectName, coolingType, coolingModel, ahriRef, heatingModel,
      totalCoolingBtu, sensibleCoolingBtu, derivedLatent, heatingBtu,
      outdoorCoolingTempF, outdoorHeatingTempF, elevationFt]);

  const isHeatPumpHeating = heatingType === 'heat_pump';
  const isFurnace = heatingType === 'furnace_gas' || heatingType === 'furnace_electric';

  return (
    <div className="h-full overflow-y-auto -webkit-overflow-scrolling-touch">
      {/* Project Gate Dialog */}
      {showGate && (
        <ProjectGateDialog
          onProjectSelected={() => setGateAccepted(true)}
          onDraft={() => setGateAccepted(true)}
        />
      )}

      {/* Project Context Bar */}
      <ProjectContextBar />

      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">

        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <PackageCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">
              {activeProjectName ? `${activeProjectName} — Manual S` : 'Manual S Calculator'}
            </h2>
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg animate-in fade-in duration-300">
                Inputs saved
              </span>
            )}
          </div>
          <p className="text-slate-400 ml-14">
            ACCA Manual S — residential equipment selection. Validate a candidate system against the Manual J loads.
          </p>
        </header>

        {/* ═══ Design Loads ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Gauge className="w-5 h-5 text-violet-400" />
              Design Loads
              {loadsSource === 'manual-j' && (
                <span className="text-[11px] font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-lg">
                  From Manual J
                </span>
              )}
            </h3>
            <button onClick={importFromManualJ}
              className="text-sm font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              Import from Manual J
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <NumField label="Total Cooling (BTU/h)" value={totalCoolingBtu} onChange={(v) => { setTotalCoolingBtu(v); setLoadsSource('manual'); }} step={100} />
            <NumField label="Sensible Cooling (BTU/h)" value={sensibleCoolingBtu} onChange={(v) => { setSensibleCoolingBtu(v); setLoadsSource('manual'); }} step={100} />
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Latent Cooling (derived)</label>
              <div className="w-full bg-slate-900/40 border border-slate-800/50 rounded-xl py-3.5 px-4 text-slate-300 font-mono text-sm min-h-[44px] flex items-center">
                {derivedLatent.toLocaleString()} <span className="text-slate-500 ml-1">BTU/h</span>
              </div>
            </div>
            <NumField label="Heating (BTU/h)" value={heatingBtu} onChange={(v) => { setHeatingBtu(v); setLoadsSource('manual'); }} step={100} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <NumField label="Outdoor Cooling (°F)" value={outdoorCoolingTempF} onChange={setOutdoorCoolingTempF} />
            <NumField label="Outdoor Heating (°F)" value={outdoorHeatingTempF} onChange={setOutdoorHeatingTempF} />
            <NumField label="Indoor Cooling (°F)" value={indoorCoolingTempF} onChange={setIndoorCoolingTempF} />
            <NumField label="Elevation (ft)" value={elevationFt} onChange={setElevationFt} step={100} />
          </div>
        </section>

        {/* ═══ Cooling Equipment ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Snowflake className="w-5 h-5 text-sky-400" />
              Cooling Equipment
              <span className="text-[11px] font-normal text-slate-500">capacities at design conditions</span>
            </h3>
            <button
              type="button"
              onClick={() => setPickerMode('cooling')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-sm font-semibold min-h-[44px]"
            >
              <PackageSearch className="w-4 h-4" /> Pick from catalog
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">System Type</label>
              <div className="flex gap-2">
                {COOLING_TYPES.map(([v, l]) => (
                  <button key={v} onClick={() => setCoolingType(v)}
                    className={`flex-1 py-3 rounded-xl border text-xs font-bold transition-all ${coolingType === v ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <TextField label="Model (optional)" value={coolingModel} onChange={setCoolingModel} placeholder="e.g. 24ACC6" />
            <TextField label="AHRI Ref # (optional)" value={ahriRef} onChange={setAhriRef} placeholder="e.g. 209123456" />
            <div className="flex items-end">
              <label className="flex items-center gap-2.5 cursor-pointer select-none py-3">
                <input type="checkbox" checked={applyAltitude} onChange={(e) => setApplyAltitude(e.target.checked)}
                  className="w-5 h-5 rounded accent-emerald-500" />
                <span className="text-sm text-slate-300 font-semibold flex items-center gap-1.5">
                  <Mountain className="w-4 h-4 text-slate-400" /> Altitude derate
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <NumField label="Total Cooling Capacity (BTU/h)" value={coolTotalCap} onChange={setCoolTotalCap} step={500} />
            <NumField label="Sensible Cooling Capacity (BTU/h)" value={coolSensCap} onChange={setCoolSensCap} step={500} />
          </div>
        </section>

        {/* ═══ Heating Equipment ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-400" />
              Heating Equipment
            </h3>
            <button
              type="button"
              onClick={() => setPickerMode('heating')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-sm font-semibold min-h-[44px]"
            >
              <PackageSearch className="w-4 h-4" /> Pick from catalog
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Heating Type</label>
              <select value={heatingType} onChange={(e) => setHeatingType(e.target.value as HeatingSystemType)}
                className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]">
                {HEATING_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {heatingType !== 'none' && (
              <>
                <TextField label="Model (optional)" value={heatingModel} onChange={setHeatingModel} placeholder="e.g. 59SC5" />
                <NumField
                  label={isHeatPumpHeating ? 'Capacity @ Design Temp (BTU/h)' : 'Output Capacity (BTU/h)'}
                  value={heatCap} onChange={setHeatCap} step={500}
                />
                {isFurnace && <NumField label="AFUE % (optional)" value={afue} onChange={setAfue} />}
                {isHeatPumpHeating && (
                  <>
                    <NumField label="Capacity @ 47°F (optional)" value={cap47} onChange={setCap47} step={500} />
                    <NumField label="Capacity @ 17°F (optional)" value={cap17} onChange={setCap17} step={500} />
                  </>
                )}
              </>
            )}
          </div>
          {isHeatPumpHeating && (
            <p className="text-xs text-slate-500 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Enter the 47°F and 17°F AHRI ratings to estimate the balance point. Below it, supplemental (auxiliary) heat carries the shortfall.
            </p>
          )}
        </section>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mb-10">
          <button onClick={runCalculation}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-base sm:text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3 min-h-[48px]">
            Check Equipment Selection <ArrowRight className="w-5 h-5" />
          </button>
          <button onClick={resetAll}
            className="py-4 px-6 rounded-2xl bg-slate-800 text-slate-400 font-bold hover:text-white transition-colors flex items-center justify-center gap-2 min-h-[48px]">
            <RotateCcw className="w-5 h-5" /> Reset
          </button>
        </div>

        {/* ═══ Results ═══ */}
        {result && (
          <section ref={resultsRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Overall verdict banner */}
            <div className={`glass-panel rounded-2xl border p-5 flex items-center gap-4 ${result.overallPass ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              {result.overallPass
                ? <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
                : <AlertTriangle className="w-8 h-8 text-red-400 shrink-0" />}
              <div>
                <p className={`text-lg font-bold ${result.overallPass ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.overallPass ? 'Within Manual S Limits' : 'Selection Needs Review'}
                </p>
                <p className="text-sm text-slate-400">
                  {result.overallPass
                    ? 'The candidate equipment satisfies the Manual S sizing rules for these loads.'
                    : 'One or more sizing checks fell outside Manual S limits — see the cards below.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Cooling verdict */}
              <VerdictCard
                title="Cooling"
                icon={<Snowflake className="w-5 h-5" />}
                tone={coolingTone(result.cooling.status)}
                statusLabel={coolingStatusLabel(result.cooling.status)}
                rows={[
                  ['Total capacity', `${result.cooling.totalCapacityBtu.toLocaleString()} BTU/h`, `${result.cooling.totalSizingPct}% of load`],
                  ['Sensible capacity', `${result.cooling.sensibleCapacityBtu.toLocaleString()} BTU/h`, `${result.cooling.sensibleSizingPct}% of load`],
                  ['Latent capacity', `${result.cooling.latentCapacityBtu.toLocaleString()} BTU/h`, `${result.cooling.latentSizingPct}% of load`],
                  ['Equipment / load SHR', `${result.cooling.equipmentShr} / ${result.cooling.loadShr}`, result.cooling.altitudeCorrectionApplied ? `altitude −${result.cooling.altitudeDeratePct}%` : ''],
                ]}
              />
              {/* Heating verdict */}
              <VerdictCard
                title="Heating"
                icon={<Flame className="w-5 h-5" />}
                tone={heatingTone(result.heating.status)}
                statusLabel={heatingStatusLabel(result.heating.status)}
                rows={[
                  ['Capacity', `${result.heating.capacityBtu.toLocaleString()} BTU/h`, result.heating.sizingPct > 0 ? `${result.heating.sizingPct}% of load` : ''],
                  ...(result.heating.supplementalHeatBtu > 0
                    ? [['Supplemental heat', `${result.heating.supplementalHeatBtu.toLocaleString()} BTU/h`, `${result.heating.supplementalHeatKw} kW aux`] as [string, string, string]]
                    : []),
                  ...(result.heating.balancePointF != null
                    ? [['Balance point', `${result.heating.balancePointF}°F`, ''] as [string, string, string]]
                    : []),
                ]}
              />
            </div>

            {/* Warnings + notes */}
            {(result.cooling.warnings.length > 0 || result.heating.warnings.length > 0) && (
              <div className="glass-panel rounded-2xl border border-amber-500/20 p-5">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> Warnings
                </h4>
                <ul className="space-y-2">
                  {[...result.cooling.warnings, ...result.heating.warnings].map((w, i) => (
                    <li key={i} className="text-xs text-amber-200/90 flex items-start gap-2">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(result.cooling.notes.length > 0 || result.heating.notes.length > 0) && (
              <div className="glass-panel rounded-2xl border border-slate-800/60 p-5">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-400" /> Notes
                </h4>
                <ul className="space-y-2">
                  {[...result.cooling.notes, ...result.heating.notes].map((n, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button onClick={exportPdf}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-semibold text-sm hover:bg-sky-500/20 hover:border-sky-500/50 transition-all min-h-[44px]">
                <ArrowRight className="w-4 h-4" /> Export PDF
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Catalog picker — fills the cooling or heating equipment block from the
          org's hvac_equipment inventory. */}
      {pickerMode && (
        <CatalogPickerModal
          mode={pickerMode}
          allowedTypes={pickerMode === 'cooling'
            ? ['ac', 'heat_pump']
            : ['heat_pump', 'furnace_gas', 'furnace_electric']}
          onSelect={applyCatalogItem}
          onClose={() => setPickerMode(null)}
        />
      )}

      {/* Mason AI Assistant */}
      <Mason context="manual-s" position="bottom-left" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local UI helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</label>
      <input type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]" />
    </div>
  );
}

const TONES: Record<string, string> = {
  emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  red: 'text-red-400 bg-red-500/10 border-red-500/30',
  slate: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

function VerdictCard({ title, icon, tone, statusLabel, rows }: {
  title: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'red' | 'slate';
  statusLabel: string;
  rows: [string, string, string][];
}) {
  const t = TONES[tone] ?? TONES.slate;
  return (
    <div className="glass-panel rounded-2xl border border-slate-800/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-bold text-white flex items-center gap-2">
          <span className={`inline-flex p-1.5 rounded-lg border ${t}`}>{icon}</span>
          {title}
        </h4>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${t}`}>{statusLabel}</span>
      </div>
      <div className="space-y-2.5">
        {rows.map(([label, value, sub], i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">{label}</span>
            <span className="text-right">
              <span className="text-sm font-bold text-white font-mono">{value}</span>
              {sub && <span className="block text-[10px] text-slate-500">{sub}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
