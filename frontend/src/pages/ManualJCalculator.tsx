import { useState, useRef, useEffect } from 'react';
import {
  Thermometer, Wind, Sun, Droplets, ArrowRight, RotateCcw,
  ChevronDown, ChevronUp, Home, Building2, Info,
  FileDown, Printer, Gauge, Shield, MapPin
} from 'lucide-react';
import type jsPDF from 'jspdf';
import {
  type RoomInput, type DesignConditions, type WholeHouseResult,
  type GlassType, type DuctLocation, type WallGradeType, type Construction, type DailyRange,
  calculateWholeHouse, tonnageFromBtu, createDefaultRoom, createDefaultConditions, GLASS_PRESETS,
} from '../engines/manualJ';
import { lookupByZip } from '../engines/ashraeWeather';
import { convertCadRoomsToManualJ } from '../engines/cadToManualJ';
import { useCadStore } from '../features/cad/store/useCadStore';
import RetailerFinderPanel from '../features/retailer/components/RetailerFinderPanel';
import { useRetailerStore } from '../features/retailer/store/useRetailerStore';
import Mason from '../components/Mason';

// ── Persistence helpers ───────────────────────────────────────────────────────
const STORAGE_KEY = 'hvac_manualj_inputs';

function loadSavedInputs(): { buildingType: 'residential' | 'commercial'; rooms: RoomInput[]; conditions: DesignConditions } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveInputs(buildingType: string, rooms: RoomInput[], conditions: DesignConditions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildingType, rooms, conditions }));
  } catch { /* storage full — silently fail */ }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ManualJCalculator() {
  const saved = useRef(loadSavedInputs()).current;
  const [buildingType, setBuildingType] = useState<'residential' | 'commercial'>(saved?.buildingType ?? 'residential');
  const [rooms, setRooms] = useState<RoomInput[]>(saved?.rooms ?? [createDefaultRoom(0)]);
  const [wholeHouse, setWholeHouse] = useState<WholeHouseResult | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [conditions, setConditions] = useState<DesignConditions>(saved?.conditions ?? createDefaultConditions());
  const resultsRef = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [zipCode, setZipCode] = useState('');
  const [zipLocation, setZipLocation] = useState<string | null>(null);

  // Auto-save all inputs to localStorage whenever they change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveInputs(buildingType, rooms, conditions);
    setSaveStatus('saved');
    const t = setTimeout(() => setSaveStatus('idle'), 1500);
    return () => clearTimeout(t);
  }, [buildingType, rooms, conditions]);

  const addRoom = () => {
    setRooms(prev => [...prev, createDefaultRoom(prev.length)]);
    setWholeHouse(null);
  };

  const importFromCad = () => {
    const cadState = useCadStore.getState();
    const floor = cadState.floors.find(f => f.id === cadState.activeFloorId);
    if (!floor || floor.rooms.length === 0) {
      alert('No detected rooms found in the CAD workspace. Use the Detect Rooms (R) tool first.');
      return;
    }
    const converted = convertCadRoomsToManualJ(floor, cadState.projectScale.pxPerFt);
    setRooms(converted);
    setWholeHouse(null);
  };

  const removeRoom = (id: string) => {
    if (rooms.length === 1) return;
    setRooms(prev => prev.filter(r => r.id !== id));
    setWholeHouse(null);
  };

  const updateRoom = (id: string, patch: Partial<RoomInput>) => {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    setWholeHouse(null);
  };

  const runCalculation = () => {
    const res = calculateWholeHouse(rooms, conditions);
    setWholeHouse(res);
  };

  const resetAll = () => {
    setRooms([createDefaultRoom(0)]);
    setConditions(createDefaultConditions());
    setBuildingType('residential');
    setWholeHouse(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const results = wholeHouse?.rooms ?? null;
  const totalHeating = wholeHouse?.totalHeatingBtu ?? 0;
  const totalCooling = wholeHouse?.totalCoolingBtu ?? 0;

  // ── Print ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!wholeHouse) return;
    const wh = wholeHouse;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Manual J Report - HVAC DesignPro</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; padding: 40px; font-size: 13px; }
        h3 { font-size: 18px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 12px; }
        th { text-align: right; font-weight: 600; color: #64748b; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
        th:first-child, td:first-child { text-align: left; }
        tr:last-child td { font-weight: 700; border-top: 2px solid #0f172a; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        .summary-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
        .summary-label { font-size: 11px; color: #64748b; font-weight: 600; }
        .summary-value { font-size: 22px; font-weight: 800; margin-top: 4px; }
        .summary-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .header { text-align: center; margin-bottom: 32px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
        .header h1 { font-size: 24px; font-weight: 800; }
        .header p { color: #64748b; font-size: 12px; margin-top: 4px; }
        .timestamp { font-size: 10px; color: #94a3b8; text-align: right; margin-top: 4px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; margin-bottom: 24px; }
        .detail-item { font-size: 11px; }
        .detail-label { color: #64748b; }
        .detail-value { font-weight: 700; }
        @media print { body { padding: 20px; } }
      </style>
    </head><body>
      <div class="header">
        <h1>HVAC DesignPro — Manual J Load Report</h1>
        <p>ACCA Manual J 8th Edition — Residential Heating & Cooling Load Calculation</p>
      </div>
      <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Total Heating</div>
          <div class="summary-value">${totalHeating.toLocaleString()} BTU/hr</div>
          <div class="summary-sub">${tonnageFromBtu(totalHeating)} tons</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total Cooling</div>
          <div class="summary-value">${totalCooling.toLocaleString()} BTU/hr</div>
          <div class="summary-sub">${tonnageFromBtu(totalCooling)} tons</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Recommended</div>
          <div class="summary-value">${wh.recommendedTons} Ton</div>
          <div class="summary-sub">SHR: ${wh.sensibleHeatRatio}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Ventilation</div>
          <div class="summary-value">${wh.ventilationCFM} CFM</div>
          <div class="summary-sub">ASHRAE 62.2</div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span class="detail-label">Duct Loss (Heating):</span> <span class="detail-value">${wh.ductLossHeating.toLocaleString()} BTU/hr</span></div>
        <div class="detail-item"><span class="detail-label">Duct Loss (Cooling):</span> <span class="detail-value">${wh.ductLossCooling.toLocaleString()} BTU/hr</span></div>
        <div class="detail-item"><span class="detail-label">Duct Location:</span> <span class="detail-value">${conditions.ductLocation}</span></div>
        <div class="detail-item"><span class="detail-label">Construction:</span> <span class="detail-value">${conditions.constructionQuality}</span></div>
        <div class="detail-item"><span class="detail-label">Outdoor Grains:</span> <span class="detail-value">${conditions.outdoorGrains} gr/lb</span></div>
        <div class="detail-item"><span class="detail-label">Indoor Grains:</span> <span class="detail-value">${conditions.indoorGrains} gr/lb</span></div>
      </div>
      <h3>Design Conditions</h3>
      <table>
        <tr><td>Outdoor Heating</td><td>${conditions.outdoorHeatingTemp}°F</td><td>Indoor Heating</td><td>${conditions.indoorHeatingTemp}°F</td></tr>
        <tr><td>Outdoor Cooling</td><td>${conditions.outdoorCoolingTemp}°F</td><td>Indoor Cooling</td><td>${conditions.indoorCoolingTemp}°F</td></tr>
        <tr><td>Building Type</td><td>${buildingType}</td><td>Latitude</td><td>${conditions.latitude}°</td></tr>
        <tr><td>Elevation</td><td>${conditions.elevation} ft</td><td>Daily Range</td><td>${conditions.coolingDailyRange}</td></tr>
      </table>
      <br/>
      <h3>Room-by-Room Results</h3>
      <table>
        <thead><tr><th style="text-align:left">Room</th><th>Heating</th><th>Sensible</th><th>Latent</th><th>Cooling Total</th></tr></thead>
        <tbody>
          ${wh.rooms.map(r => `<tr><td style="font-weight:600">${r.roomName}</td><td>${r.heatingBtu.toLocaleString()}</td><td>${r.coolingBtuSensible.toLocaleString()}</td><td>${r.coolingBtuLatent.toLocaleString()}</td><td style="font-weight:700">${r.coolingBtuTotal.toLocaleString()}</td></tr>`).join('')}
          <tr><td>TOTAL</td><td>${totalHeating.toLocaleString()}</td><td>${wh.totalCoolingSensible.toLocaleString()}</td><td>${wh.totalCoolingLatent.toLocaleString()}</td><td>${totalCooling.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <br/><p style="font-size:10px;color:#94a3b8;text-align:center;margin-top:24px;">HVAC DesignPro — ACCA Manual J 8th Edition — For reference only, not a substitute for PE-stamped calculations.</p>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  // ── Export PDF ──────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!wholeHouse) return;
    const wh = wholeHouse;
    const { default: JsPDF } = await import('jspdf');
    const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pw = doc.internal.pageSize.getWidth();
    const margin = 50;
    let y = 50;

    // Title block
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('HVAC DesignPro', pw / 2, y, { align: 'center' });
    y += 18;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Manual J 8th Edition — Load Calculation Report', pw / 2, y, { align: 'center' });
    y += 12;
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pw / 2, y, { align: 'center' });
    y += 6;
    doc.setDrawColor(0); doc.setLineWidth(1.5);
    doc.line(margin, y, pw - margin, y);
    y += 24;

    // Summary
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Summary', margin, y); y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const summaryData = [
      ['Total Heating Load', `${totalHeating.toLocaleString()} BTU/hr`, `${tonnageFromBtu(totalHeating)} tons`],
      ['Total Cooling Load', `${totalCooling.toLocaleString()} BTU/hr`, `${tonnageFromBtu(totalCooling)} tons`],
      ['Recommended System', `${wh.recommendedTons} Ton`, `SHR: ${wh.sensibleHeatRatio}`],
      ['Ventilation (62.2)', `${wh.ventilationCFM} CFM`, `${wh.ventilationSensible.toLocaleString()} BTU/hr sensible`],
      ['Duct Loss (Heating)', `${wh.ductLossHeating.toLocaleString()} BTU/hr`, `Location: ${conditions.ductLocation}`],
      ['Duct Loss (Cooling)', `${wh.ductLossCooling.toLocaleString()} BTU/hr`, `R-${conditions.ductInsulationR}, ${conditions.ductLeakagePercent}% leak`],
    ];
    summaryData.forEach(([label, val, sub]) => {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
      doc.text(label, margin, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
      doc.text(val, margin + 180, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(130);
      doc.text(sub, margin + 360, y);
      y += 16;
    });
    y += 10;

    // Design Conditions
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text('Design Conditions', margin, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60);
    const condData = [
      [`Outdoor Heating: ${conditions.outdoorHeatingTemp}°F`, `Indoor Heating: ${conditions.indoorHeatingTemp}°F`],
      [`Outdoor Cooling: ${conditions.outdoorCoolingTemp}°F`, `Indoor Cooling: ${conditions.indoorCoolingTemp}°F`],
      [`Outdoor Grains: ${conditions.outdoorGrains} gr/lb`, `Indoor Grains: ${conditions.indoorGrains} gr/lb`],
      [`Elevation: ${conditions.elevation} ft`, `Construction: ${conditions.constructionQuality}`],
      [`Building Type: ${buildingType}`, `Daily Range: ${conditions.coolingDailyRange}`],
    ];
    condData.forEach(([left, right]) => {
      doc.text(left, margin, y);
      doc.text(right, margin + 220, y);
      y += 14;
    });
    y += 10;

    // Room-by-Room Table
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text('Room-by-Room Results', margin, y); y += 18;

    const cols = [margin, margin + 140, margin + 260, margin + 360, margin + 440];
    const headers = ['Room', 'Heating (BTU/hr)', 'Cooling Sensible', 'Cooling Latent', 'Cooling Total'];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
    headers.forEach((h, i) => {
      doc.text(h, cols[i], y, { align: i === 0 ? 'left' : 'right' });
    });
    y += 4;
    doc.setDrawColor(200); doc.setLineWidth(0.5);
    doc.line(margin, y, pw - margin, y);
    y += 12;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30);
    wh.rooms.forEach((r) => {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'bold');
      doc.text(r.roomName, cols[0], y);
      doc.setFont('helvetica', 'normal');
      doc.text(r.heatingBtu.toLocaleString(), cols[1], y, { align: 'right' });
      doc.text(r.coolingBtuSensible.toLocaleString(), cols[2], y, { align: 'right' });
      doc.text(r.coolingBtuLatent.toLocaleString(), cols[3], y, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(r.coolingBtuTotal.toLocaleString(), cols[4], y, { align: 'right' });
      y += 16;
    });

    // Totals row
    doc.setDrawColor(0); doc.setLineWidth(1);
    doc.line(margin, y - 4, pw - margin, y - 4);
    y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
    doc.text('TOTAL', cols[0], y);
    doc.text(totalHeating.toLocaleString(), cols[1], y, { align: 'right' });
    doc.text(wh.totalCoolingSensible.toLocaleString(), cols[2], y, { align: 'right' });
    doc.text(wh.totalCoolingLatent.toLocaleString(), cols[3], y, { align: 'right' });
    doc.text(totalCooling.toLocaleString(), cols[4], y, { align: 'right' });

    // Footer
    y = doc.internal.pageSize.getHeight() - 30;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150);
    doc.text('HVAC DesignPro — ACCA Manual J 8th Edition — For reference only, not a substitute for PE-stamped calculations.', pw / 2, y, { align: 'center' });

    doc.save(`ManualJ_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="h-full overflow-y-auto -webkit-overflow-scrolling-touch">
      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <Thermometer className="w-6 h-6 text-orange-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">Manual J Calculator</h2>
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg animate-in fade-in duration-300">
                Inputs saved
              </span>
            )}
          </div>
          <p className="text-slate-400 ml-14">
            ACCA Manual J 8th Edition — residential & light commercial heating/cooling load calculation.
          </p>
        </header>

        {/* ═══ Design Conditions ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Sun className="w-5 h-5 text-amber-400" />
            Design Conditions
          </h3>

          {/* ASHRAE Zip Code Lookup */}
          <div className="mb-6 p-4 rounded-2xl bg-slate-800/30 border border-slate-700/40">
            <div className="flex items-center gap-3 mb-3">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">ASHRAE Weather Data Lookup</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={zipCode}
                onChange={e => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="Enter ZIP code..."
                className="w-40 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
                maxLength={5}
              />
              <button
                onClick={() => {
                  const result = lookupByZip(zipCode);
                  if (result.found && result.conditions) {
                    setConditions(c => ({ ...c, ...result.conditions }));
                    setZipLocation(`${result.city}, ${result.state}`);
                  } else {
                    setZipLocation(null);
                    alert(`No ASHRAE data found for ZIP ${zipCode}. Enter outdoor conditions manually.`);
                  }
                }}
                disabled={zipCode.length < 3}
                className="px-5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Auto-Fill
              </button>
              {zipLocation && (
                <span className="text-sm text-emerald-400 font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {zipLocation} — ASHRAE 99%/1% design temps applied
                </span>
              )}
            </div>
          </div>

          {/* Temperatures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <NumericField label="Outdoor Heating (°F)" value={conditions.outdoorHeatingTemp}
              onChange={v => setConditions(c => ({ ...c, outdoorHeatingTemp: v }))} />
            <NumericField label="Outdoor Cooling (°F)" value={conditions.outdoorCoolingTemp}
              onChange={v => setConditions(c => ({ ...c, outdoorCoolingTemp: v }))} />
            <NumericField label="Indoor Heating (°F)" value={conditions.indoorHeatingTemp}
              onChange={v => setConditions(c => ({ ...c, indoorHeatingTemp: v }))} />
            <NumericField label="Indoor Cooling (°F)" value={conditions.indoorCoolingTemp}
              onChange={v => setConditions(c => ({ ...c, indoorCoolingTemp: v }))} />
          </div>

          {/* Humidity & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <NumericField label="Outdoor Grains (gr/lb)" value={conditions.outdoorGrains}
              onChange={v => setConditions(c => ({ ...c, outdoorGrains: v }))} />
            <NumericField label="Indoor Grains (gr/lb)" value={conditions.indoorGrains}
              onChange={v => setConditions(c => ({ ...c, indoorGrains: v }))} />
            <NumericField label="Latitude (°)" value={conditions.latitude}
              onChange={v => setConditions(c => ({ ...c, latitude: v }))} />
            <NumericField label="Elevation (ft)" value={conditions.elevation}
              onChange={v => setConditions(c => ({ ...c, elevation: v }))} />
          </div>

          {/* Building & Construction */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Building Type</label>
              <div className="flex gap-2">
                <button onClick={() => setBuildingType('residential')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all ${buildingType === 'residential' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                  <Home className="w-4 h-4" /> Res
                </button>
                <button onClick={() => setBuildingType('commercial')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all ${buildingType === 'commercial' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                  <Building2 className="w-4 h-4" /> Com
                </button>
              </div>
            </div>
            <SelectField label="Construction Quality" value={conditions.constructionQuality}
              options={[['tight', 'Tight (0.25 ACH)'], ['average', 'Average (0.50 ACH)'], ['leaky', 'Leaky (0.75 ACH)']]}
              onChange={v => setConditions(c => ({ ...c, constructionQuality: v as Construction }))} />
            <SelectField label="Daily Range" value={conditions.coolingDailyRange}
              options={[['low', 'Low (<16°F)'], ['medium', 'Medium (16-25°F)'], ['high', 'High (>25°F)']]}
              onChange={v => setConditions(c => ({ ...c, coolingDailyRange: v as DailyRange }))} />
            <NumericField label="Total Floor Area (ft²)" value={conditions.totalFloorArea}
              onChange={v => setConditions(c => ({ ...c, totalFloorArea: v }))} />
          </div>

          {/* Bedrooms */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <NumericField label="Bedrooms (#)" value={conditions.numBedrooms}
              onChange={v => setConditions(c => ({ ...c, numBedrooms: v }))} />
          </div>
        </section>

        {/* ═══ Duct System ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-violet-400" />
            Duct System
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <SelectField label="Duct Location" value={conditions.ductLocation}
              options={[
                ['conditioned', 'Conditioned Space'],
                ['attic', 'Attic'],
                ['crawlspace', 'Crawlspace'],
                ['garage', 'Garage'],
                ['basement_uncond', 'Uncond. Basement'],
              ]}
              onChange={v => setConditions(c => ({ ...c, ductLocation: v as DuctLocation }))} />
            <NumericField label="Duct Insulation (R)" value={conditions.ductInsulationR}
              onChange={v => setConditions(c => ({ ...c, ductInsulationR: v }))} />
            <NumericField label="Duct Leakage (%)" value={conditions.ductLeakagePercent}
              onChange={v => setConditions(c => ({ ...c, ductLeakagePercent: v }))} />
            <NumericField label="Duct Run Length (ft)" value={conditions.ductLengthFt}
              onChange={v => setConditions(c => ({ ...c, ductLengthFt: v }))} />
          </div>
        </section>

        {/* ═══ Room-by-Room Inputs ═══ */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Wind className="w-5 h-5 text-sky-400" />
              Room-by-Room Inputs
            </h3>
            <div className="flex items-center gap-3">
              <button onClick={importFromCad}
                className="text-sm font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1.5"
                title="Import detected rooms from CAD floor plan">
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                Import from CAD
              </button>
              <button onClick={addRoom}
                className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors">
                + Add Room
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {rooms.map((room, idx) => (
              <RoomInputCard
                key={room.id}
                room={room}
                index={idx}
                expanded={expandedRoom === room.id}
                onToggle={() => setExpandedRoom(expandedRoom === room.id ? null : room.id)}
                onChange={(patch) => updateRoom(room.id, patch)}
                onRemove={() => removeRoom(room.id)}
                canRemove={rooms.length > 1}
              />
            ))}
          </div>
        </section>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mb-10">
          <button onClick={runCalculation}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-base sm:text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3 min-h-[48px]">
            Calculate Loads <ArrowRight className="w-5 h-5" />
          </button>
          <button onClick={resetAll}
            className="py-4 px-6 rounded-2xl bg-slate-800 text-slate-400 font-bold hover:text-white transition-colors flex items-center justify-center gap-2 min-h-[48px]">
            <RotateCcw className="w-5 h-5" /> Reset
          </button>
        </div>

        {/* ═══ Results ═══ */}
        {wholeHouse && results && (
          <section ref={resultsRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard label="Total Heating" value={`${totalHeating.toLocaleString()}`} sub={`${tonnageFromBtu(totalHeating)} tons`}
                color="orange" icon={<Thermometer className="w-5 h-5" />} unit="BTU/hr" />
              <SummaryCard label="Total Cooling" value={`${totalCooling.toLocaleString()}`} sub={`${tonnageFromBtu(totalCooling)} tons`}
                color="sky" icon={<Droplets className="w-5 h-5" />} unit="BTU/hr" />
              <SummaryCard label="Recommended" value={`${wholeHouse.recommendedTons} Ton`} sub={`SHR: ${wholeHouse.sensibleHeatRatio}`}
                color="emerald" icon={<Wind className="w-5 h-5" />} />
              <SummaryCard label="Ventilation" value={`${wholeHouse.ventilationCFM} CFM`} sub="ASHRAE 62.2"
                color="violet" icon={<Shield className="w-5 h-5" />} />
            </div>

            {/* Advanced Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <MiniStat label="Duct Loss (Heating)" value={`${wholeHouse.ductLossHeating.toLocaleString()} BTU/hr`} />
              <MiniStat label="Duct Loss (Cooling)" value={`${wholeHouse.ductLossCooling.toLocaleString()} BTU/hr`} />
              <MiniStat label="Sensible Heat Ratio" value={`${wholeHouse.sensibleHeatRatio}`} />
              <MiniStat label="Ventilation Sensible" value={`${wholeHouse.ventilationSensible.toLocaleString()} BTU/hr`} />
              <MiniStat label="Ventilation Latent" value={`${wholeHouse.ventilationLatent.toLocaleString()} BTU/hr`} />
              <MiniStat label="Cooling Latent Total" value={`${wholeHouse.totalCoolingLatent.toLocaleString()} BTU/hr`} />
            </div>

            {/* Export / Print Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button onClick={handleExportPdf}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-semibold text-sm hover:bg-sky-500/20 hover:border-sky-500/50 transition-all min-h-[44px]">
                <FileDown className="w-4 h-4" /> Export PDF
              </button>
              <button onClick={handlePrint}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 font-semibold text-sm hover:bg-slate-700/50 hover:text-white transition-all min-h-[44px]">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button onClick={() => {
                  useRetailerStore.getState().open();
                  if (wholeHouse) useRetailerStore.getState().generateEstimate(wholeHouse, conditions);
                }}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold text-sm hover:bg-amber-500/20 hover:border-amber-500/50 transition-all min-h-[44px]">
                <MapPin className="w-4 h-4" /> Find Retailer & Estimate
              </button>
            </div>

            {/* Room Breakdown Table */}
            <div className="glass-panel rounded-3xl border border-slate-800/60 overflow-hidden">
              <div className="p-6 border-b border-slate-800/60">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Info className="w-5 h-5 text-slate-400" />
                  Room-by-Room Results
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800/60 text-slate-400 uppercase text-xs tracking-wider">
                      <th className="text-left p-4 font-semibold">Room</th>
                      <th className="text-right p-4 font-semibold">Heating</th>
                      <th className="text-right p-4 font-semibold">Sensible</th>
                      <th className="text-right p-4 font-semibold">Latent</th>
                      <th className="text-right p-4 font-semibold">Cooling Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.roomId} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors">
                        <td className="p-4 font-semibold text-white">{r.roomName}</td>
                        <td className="p-4 text-right text-orange-400 font-mono">{r.heatingBtu.toLocaleString()}</td>
                        <td className="p-4 text-right text-sky-400 font-mono">{r.coolingBtuSensible.toLocaleString()}</td>
                        <td className="p-4 text-right text-sky-300 font-mono">{r.coolingBtuLatent.toLocaleString()}</td>
                        <td className="p-4 text-right text-emerald-400 font-bold font-mono">{r.coolingBtuTotal.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-800/30 font-bold">
                      <td className="p-4 text-white">TOTAL</td>
                      <td className="p-4 text-right text-orange-400 font-mono">{totalHeating.toLocaleString()}</td>
                      <td className="p-4 text-right text-sky-400 font-mono">{wholeHouse.totalCoolingSensible.toLocaleString()}</td>
                      <td className="p-4 text-right text-sky-300 font-mono">{wholeHouse.totalCoolingLatent.toLocaleString()}</td>
                      <td className="p-4 text-right text-emerald-400 font-mono">{totalCooling.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Retailer Finder Slide-Over */}
        {wholeHouse && (
          <RetailerFinderPanel wholeHouse={wholeHouse} conditions={conditions} />
        )}
      </div>

      {/* Mason — AI HVAC Assistant */}
      <Mason context="manualj" />
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function NumericField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 sm:mb-2">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 sm:mb-2">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3.5 px-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]">
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
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
      <div className={`inline-flex p-2 rounded-xl border mb-3 ${c}`}>
        {icon}
      </div>
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

interface RoomInputCardProps {
  room: RoomInput;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RoomInput>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function RoomInputCard({ room, index, expanded, onToggle, onChange, onRemove, canRemove }: RoomInputCardProps) {
  const applyGlassPreset = (glassType: GlassType) => {
    const preset = GLASS_PRESETS[glassType];
    onChange({ glassType, windowUValue: preset.u, windowSHGC: preset.shgc });
  };

  return (
    <div className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between p-5 hover:bg-slate-800/20 transition-colors">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-300">
            {index + 1}
          </span>
          <input type="text" value={room.name}
            onChange={e => { e.stopPropagation(); onChange({ name: e.target.value }); }}
            onClick={e => e.stopPropagation()}
            className="bg-transparent text-white font-semibold focus:outline-none focus:border-b focus:border-emerald-500 transition-all" />
          <span className="text-xs text-slate-500">
            {room.lengthFt}' x {room.widthFt}' x {room.ceilingHeightFt}'
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canRemove && (
            <button onClick={e => { e.stopPropagation(); onRemove(); }}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors">Remove</button>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="p-5 pt-0 border-t border-slate-800/40 animate-in slide-in-from-top-2 fade-in duration-300">
          {/* Dimensions */}
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-5 mb-3">Dimensions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumericField label="Length (ft)" value={room.lengthFt} onChange={v => onChange({ lengthFt: v })} />
            <NumericField label="Width (ft)" value={room.widthFt} onChange={v => onChange({ widthFt: v })} />
            <NumericField label="Ceiling Ht (ft)" value={room.ceilingHeightFt} onChange={v => onChange({ ceilingHeightFt: v })} />
            <NumericField label="Exterior Walls" value={room.exteriorWalls} onChange={v => onChange({ exteriorWalls: v })} />
          </div>

          {/* Walls */}
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-5 mb-3">Walls</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumericField label="Wall R-Value" value={room.wallRValue} onChange={v => onChange({ wallRValue: v })} />
            <SelectField label="Wall Grade" value={room.wallGrade}
              options={[['above', 'Above Grade'], ['below_partial', 'Partial Below Grade'], ['below_full', 'Fully Below Grade']]}
              onChange={v => onChange({ wallGrade: v as WallGradeType })} />
            {room.wallGrade !== 'above' && (
              <NumericField label="Below-Grade Depth (ft)" value={room.belowGradeDepthFt}
                onChange={v => onChange({ belowGradeDepthFt: v })} />
            )}
            <SelectField label="Exposure" value={room.exposureDirection}
              options={(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const).map(d => [d, d])}
              onChange={v => onChange({ exposureDirection: v as RoomInput['exposureDirection'] })} />
          </div>

          {/* Windows / Solar */}
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-5 mb-3">Windows & Solar</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumericField label="Window Area (ft²)" value={room.windowSqFt} onChange={v => onChange({ windowSqFt: v })} />
            <NumericField label="Window Count" value={room.windowCount} onChange={v => onChange({ windowCount: v })} />
            <SelectField label="Glass Type" value={room.glassType}
              options={(Object.entries(GLASS_PRESETS) as [GlassType, { label: string }][]).map(([k, v]) => [k, v.label])}
              onChange={v => applyGlassPreset(v as GlassType)} />
            <NumericField label="SHGC" value={room.windowSHGC} onChange={v => onChange({ windowSHGC: v })} step={0.01} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <NumericField label="Window U-Value" value={room.windowUValue} onChange={v => onChange({ windowUValue: v })} step={0.01} />
            <NumericField label="Interior Shading" value={room.interiorShading} onChange={v => onChange({ interiorShading: v })} step={0.1} />
          </div>

          {/* Ceiling & Floor */}
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-5 mb-3">Ceiling & Floor</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumericField label="Ceiling R-Value" value={room.ceilingRValue} onChange={v => onChange({ ceilingRValue: v })} />
            <NumericField label="Floor R-Value" value={room.floorRValue} onChange={v => onChange({ floorRValue: v })} />
            <SelectField label="Floor Type" value={room.floorType}
              options={[['slab', 'Slab on Grade'], ['crawlspace', 'Crawlspace'], ['basement', 'Basement'], ['over_conditioned', 'Over Conditioned']]}
              onChange={v => onChange({ floorType: v as RoomInput['floorType'] })} />
            <NumericField label="Occupants" value={room.occupantCount} onChange={v => onChange({ occupantCount: v })} />
          </div>
        </div>
      )}
    </div>
  );
}
