import { useState, useRef } from 'react';
import {
  Thermometer, Wind, Sun, Droplets, ArrowRight, RotateCcw,
  ChevronDown, ChevronUp, Home, Building2, Info,
  FileDown, Printer
} from 'lucide-react';
import jsPDF from 'jspdf';

// ── Types ─────────────────────────────────────────────────────────────────────
interface RoomInput {
  id: string;
  name: string;
  lengthFt: number;
  widthFt: number;
  ceilingHeightFt: number;
  windowSqFt: number;
  windowCount: number;
  exteriorWalls: number;
  wallRValue: number;
  windowUValue: number;
  ceilingRValue: number;
  floorRValue: number;
  floorType: 'slab' | 'crawlspace' | 'basement' | 'over_conditioned';
  exposureDirection: 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
}

interface DesignConditions {
  outdoorHeatingTemp: number;
  outdoorCoolingTemp: number;
  indoorHeatingTemp: number;
  indoorCoolingTemp: number;
  latitude: number;
  coolingDailyRange: 'low' | 'medium' | 'high';
}

interface RoomResult {
  roomId: string;
  roomName: string;
  heatingBtu: number;
  coolingBtuSensible: number;
  coolingBtuLatent: number;
  coolingBtuTotal: number;
  breakdown: {
    wallLoss: number;
    windowLoss: number;
    ceilingLoss: number;
    floorLoss: number;
    infiltration: number;
    solarGain: number;
    internalGain: number;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const INFILTRATION_ACH = 0.5; // air changes per hour (average construction)
const AIR_HEAT_FACTOR = 1.08; // BTU/(hr·CFM·°F) sensible
const SOLAR_GAIN_FACTOR: Record<string, number> = {
  N: 20, NE: 40, NW: 40, E: 80, SE: 100, S: 60, SW: 100, W: 80,
};
const INTERNAL_GAIN_PER_SQFT = 1.5; // BTU/hr per sq ft (people, lights, appliances)
const LATENT_FRACTION = 0.3; // latent fraction of total cooling load

// ── Calculation Engine (simplified ACCA Manual J) ─────────────────────────────
function calculateRoom(room: RoomInput, conditions: DesignConditions): RoomResult {
  const floorArea = room.lengthFt * room.widthFt;
  const volume = floorArea * room.ceilingHeightFt;
  const wallArea = (room.exteriorWalls * room.lengthFt * room.ceilingHeightFt) - room.windowSqFt;
  const heatingDeltaT = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
  const coolingDeltaT = conditions.outdoorCoolingTemp - conditions.indoorCoolingTemp;

  // ── Heating Losses ──────────────────────────────────────────────────────
  const wallLossHeating = (wallArea / room.wallRValue) * heatingDeltaT;
  const windowLossHeating = (room.windowSqFt * room.windowUValue) * heatingDeltaT;
  const ceilingLossHeating = (floorArea / room.ceilingRValue) * heatingDeltaT;

  let floorLossHeating = 0;
  if (room.floorType === 'slab') {
    floorLossHeating = (floorArea / room.floorRValue) * heatingDeltaT * 0.5;
  } else if (room.floorType === 'crawlspace') {
    floorLossHeating = (floorArea / room.floorRValue) * heatingDeltaT * 0.7;
  } else if (room.floorType === 'basement') {
    floorLossHeating = (floorArea / room.floorRValue) * heatingDeltaT * 0.4;
  }

  const infiltrationCFM = (volume * INFILTRATION_ACH) / 60;
  const infiltrationHeating = AIR_HEAT_FACTOR * infiltrationCFM * heatingDeltaT;

  const heatingBtu = Math.round(
    wallLossHeating + windowLossHeating + ceilingLossHeating + floorLossHeating + infiltrationHeating
  );

  // ── Cooling Gains ───────────────────────────────────────────────────────
  const wallGainCooling = (wallArea / room.wallRValue) * coolingDeltaT;
  const windowGainCooling = (room.windowSqFt * room.windowUValue) * coolingDeltaT;
  const ceilingGainCooling = (floorArea / room.ceilingRValue) * coolingDeltaT;

  let floorGainCooling = 0;
  if (room.floorType === 'crawlspace') {
    floorGainCooling = (floorArea / room.floorRValue) * coolingDeltaT * 0.3;
  }

  const infiltrationCooling = AIR_HEAT_FACTOR * infiltrationCFM * coolingDeltaT;
  const solarGain = room.windowSqFt * (SOLAR_GAIN_FACTOR[room.exposureDirection] ?? 60);
  const internalGain = floorArea * INTERNAL_GAIN_PER_SQFT;

  const coolingBtuSensible = Math.round(
    wallGainCooling + windowGainCooling + ceilingGainCooling + floorGainCooling +
    infiltrationCooling + solarGain + internalGain
  );
  const coolingBtuLatent = Math.round(coolingBtuSensible * LATENT_FRACTION);
  const coolingBtuTotal = coolingBtuSensible + coolingBtuLatent;

  return {
    roomId: room.id,
    roomName: room.name,
    heatingBtu,
    coolingBtuSensible,
    coolingBtuLatent,
    coolingBtuTotal,
    breakdown: {
      wallLoss: Math.round(wallLossHeating),
      windowLoss: Math.round(windowLossHeating),
      ceilingLoss: Math.round(ceilingLossHeating),
      floorLoss: Math.round(floorLossHeating),
      infiltration: Math.round(infiltrationHeating),
      solarGain: Math.round(solarGain),
      internalGain: Math.round(internalGain),
    },
  };
}

function tonnageFromBtu(btu: number): string {
  return (btu / 12000).toFixed(2);
}

// ── Default Room ──────────────────────────────────────────────────────────────
function createDefaultRoom(index: number): RoomInput {
  return {
    id: `room-${Date.now()}-${index}`,
    name: `Room ${index + 1}`,
    lengthFt: 12,
    widthFt: 10,
    ceilingHeightFt: 8,
    windowSqFt: 15,
    windowCount: 1,
    exteriorWalls: 1,
    wallRValue: 13,
    windowUValue: 0.5,
    ceilingRValue: 38,
    floorRValue: 19,
    floorType: 'crawlspace',
    exposureDirection: 'S',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ManualJCalculator() {
  const [buildingType, setBuildingType] = useState<'residential' | 'commercial'>('residential');
  const [rooms, setRooms] = useState<RoomInput[]>([createDefaultRoom(0)]);
  const [results, setResults] = useState<RoomResult[] | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);

  const [conditions, setConditions] = useState<DesignConditions>({
    outdoorHeatingTemp: 5,
    outdoorCoolingTemp: 95,
    indoorHeatingTemp: 70,
    indoorCoolingTemp: 75,
    latitude: 40,
    coolingDailyRange: 'medium',
  });

  const addRoom = () => {
    setRooms(prev => [...prev, createDefaultRoom(prev.length)]);
    setResults(null);
  };

  const removeRoom = (id: string) => {
    if (rooms.length === 1) return;
    setRooms(prev => prev.filter(r => r.id !== id));
    setResults(null);
  };

  const updateRoom = (id: string, patch: Partial<RoomInput>) => {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    setResults(null);
  };

  const runCalculation = () => {
    const res = rooms.map(room => calculateRoom(room, conditions));
    setResults(res);
  };

  const resetAll = () => {
    setRooms([createDefaultRoom(0)]);
    setResults(null);
  };

  const totalHeating = results?.reduce((sum, r) => sum + r.heatingBtu, 0) ?? 0;
  const totalCooling = results?.reduce((sum, r) => sum + r.coolingBtuTotal, 0) ?? 0;
  const resultsRef = useRef<HTMLDivElement>(null);

  // ── Print ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!resultsRef.current) return;
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
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
        .summary-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
        .summary-label { font-size: 11px; color: #64748b; font-weight: 600; }
        .summary-value { font-size: 22px; font-weight: 800; margin-top: 4px; }
        .summary-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .header { text-align: center; margin-bottom: 32px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
        .header h1 { font-size: 24px; font-weight: 800; }
        .header p { color: #64748b; font-size: 12px; margin-top: 4px; }
        .timestamp { font-size: 10px; color: #94a3b8; text-align: right; margin-top: 4px; }
        @media print { body { padding: 20px; } }
      </style>
    </head><body>
      <div class="header">
        <h1>HVAC DesignPro — Manual J Load Report</h1>
        <p>ACCA Manual J Residential Heating & Cooling Load Calculation</p>
      </div>
      <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Total Heating Load</div>
          <div class="summary-value">${totalHeating.toLocaleString()} BTU/hr</div>
          <div class="summary-sub">${tonnageFromBtu(totalHeating)} tons</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total Cooling Load</div>
          <div class="summary-value">${totalCooling.toLocaleString()} BTU/hr</div>
          <div class="summary-sub">${tonnageFromBtu(totalCooling)} tons</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Recommended System</div>
          <div class="summary-value">${Math.ceil(totalCooling / 12000 * 2) / 2} Ton</div>
          <div class="summary-sub">${rooms.length} zone${rooms.length > 1 ? 's' : ''}</div>
        </div>
      </div>
      <h3>Design Conditions</h3>
      <table>
        <tr><td>Outdoor Heating</td><td>${conditions.outdoorHeatingTemp}°F</td><td>Indoor Heating</td><td>${conditions.indoorHeatingTemp}°F</td></tr>
        <tr><td>Outdoor Cooling</td><td>${conditions.outdoorCoolingTemp}°F</td><td>Indoor Cooling</td><td>${conditions.indoorCoolingTemp}°F</td></tr>
        <tr><td>Building Type</td><td>${buildingType}</td><td>Latitude</td><td>${conditions.latitude}°</td></tr>
      </table>
      <br/>
      <h3>Room-by-Room Results</h3>
      <table>
        <thead><tr><th style="text-align:left">Room</th><th>Heating (BTU/hr)</th><th>Cooling Sensible</th><th>Cooling Latent</th><th>Cooling Total</th></tr></thead>
        <tbody>
          ${results!.map(r => `<tr><td style="font-weight:600">${r.roomName}</td><td>${r.heatingBtu.toLocaleString()}</td><td>${r.coolingBtuSensible.toLocaleString()}</td><td>${r.coolingBtuLatent.toLocaleString()}</td><td style="font-weight:700">${r.coolingBtuTotal.toLocaleString()}</td></tr>`).join('')}
          <tr><td>TOTAL</td><td>${totalHeating.toLocaleString()}</td><td>${results!.reduce((s,r)=>s+r.coolingBtuSensible,0).toLocaleString()}</td><td>${results!.reduce((s,r)=>s+r.coolingBtuLatent,0).toLocaleString()}</td><td>${totalCooling.toLocaleString()}</td></tr>
        </tbody>
      </table>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  // ── Export PDF ──────────────────────────────────────────────────────────
  const handleExportPdf = () => {
    if (!results) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
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
    doc.text('Manual J Load Calculation Report', pw / 2, y, { align: 'center' });
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
      ['Recommended System', `${Math.ceil(totalCooling / 12000 * 2) / 2} Ton`, `${rooms.length} zone${rooms.length > 1 ? 's' : ''}`],
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
      [`Building Type: ${buildingType}`, `Latitude: ${conditions.latitude}°`],
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

    // Table header
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

    // Table rows
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30);
    results.forEach((r) => {
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
    doc.text(results.reduce((s,r)=>s+r.coolingBtuSensible,0).toLocaleString(), cols[2], y, { align: 'right' });
    doc.text(results.reduce((s,r)=>s+r.coolingBtuLatent,0).toLocaleString(), cols[3], y, { align: 'right' });
    doc.text(totalCooling.toLocaleString(), cols[4], y, { align: 'right' });

    // Footer
    y = doc.internal.pageSize.getHeight() - 30;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150);
    doc.text('HVAC DesignPro — Simplified ACCA Manual J — For reference only, not a substitute for PE-stamped calculations.', pw / 2, y, { align: 'center' });

    doc.save(`ManualJ_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-8 pt-12 pb-24">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <Thermometer className="w-6 h-6 text-orange-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">Manual J Calculator</h2>
          </div>
          <p className="text-slate-400 ml-14">
            ACCA Manual J residential & light commercial heating/cooling load calculation.
          </p>
        </header>

        {/* Design Conditions Panel */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Sun className="w-5 h-5 text-amber-400" />
            Design Conditions
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <NumericField
              label="Outdoor Heating (°F)"
              value={conditions.outdoorHeatingTemp}
              onChange={v => setConditions(c => ({ ...c, outdoorHeatingTemp: v }))}
            />
            <NumericField
              label="Outdoor Cooling (°F)"
              value={conditions.outdoorCoolingTemp}
              onChange={v => setConditions(c => ({ ...c, outdoorCoolingTemp: v }))}
            />
            <NumericField
              label="Indoor Heating (°F)"
              value={conditions.indoorHeatingTemp}
              onChange={v => setConditions(c => ({ ...c, indoorHeatingTemp: v }))}
            />
            <NumericField
              label="Indoor Cooling (°F)"
              value={conditions.indoorCoolingTemp}
              onChange={v => setConditions(c => ({ ...c, indoorCoolingTemp: v }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <NumericField
              label="Latitude (°)"
              value={conditions.latitude}
              onChange={v => setConditions(c => ({ ...c, latitude: v }))}
            />
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Building Type</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setBuildingType('residential')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all ${buildingType === 'residential' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                >
                  <Home className="w-4 h-4" /> Residential
                </button>
                <button
                  onClick={() => setBuildingType('commercial')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all ${buildingType === 'commercial' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                >
                  <Building2 className="w-4 h-4" /> Commercial
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Room-by-Room Inputs */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Wind className="w-5 h-5 text-sky-400" />
              Room-by-Room Inputs
            </h3>
            <button
              onClick={addRoom}
              className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              + Add Room
            </button>
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
        <div className="flex gap-4 mb-10">
          <button
            onClick={runCalculation}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3"
          >
            Calculate Loads <ArrowRight className="w-5 h-5" />
          </button>
          <button
            onClick={resetAll}
            className="py-4 px-6 rounded-2xl bg-slate-800 text-slate-400 font-bold hover:text-white transition-colors flex items-center gap-2"
          >
            <RotateCcw className="w-5 h-5" /> Reset
          </button>
        </div>

        {/* Results */}
        {results && (
          <section ref={resultsRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <SummaryCard
                label="Total Heating Load"
                value={`${totalHeating.toLocaleString()} BTU/hr`}
                sub={`${tonnageFromBtu(totalHeating)} tons`}
                color="orange"
                icon={<Thermometer className="w-6 h-6" />}
              />
              <SummaryCard
                label="Total Cooling Load"
                value={`${totalCooling.toLocaleString()} BTU/hr`}
                sub={`${tonnageFromBtu(totalCooling)} tons`}
                color="sky"
                icon={<Droplets className="w-6 h-6" />}
              />
              <SummaryCard
                label="Recommended System"
                value={`${Math.ceil(totalCooling / 12000 * 2) / 2} Ton`}
                sub={`${rooms.length} zone${rooms.length > 1 ? 's' : ''}`}
                color="emerald"
                icon={<Wind className="w-6 h-6" />}
              />
            </div>

            {/* Export / Print Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleExportPdf}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-semibold text-sm hover:bg-sky-500/20 hover:border-sky-500/50 transition-all"
              >
                <FileDown className="w-4 h-4" /> Export PDF
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 font-semibold text-sm hover:bg-slate-700/50 hover:text-white transition-all"
              >
                <Printer className="w-4 h-4" /> Print
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
                      <th className="text-right p-4 font-semibold">Heating (BTU/hr)</th>
                      <th className="text-right p-4 font-semibold">Cooling Sensible</th>
                      <th className="text-right p-4 font-semibold">Cooling Latent</th>
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
                      <td className="p-4 text-right text-sky-400 font-mono">{results.reduce((s, r) => s + r.coolingBtuSensible, 0).toLocaleString()}</td>
                      <td className="p-4 text-right text-sky-300 font-mono">{results.reduce((s, r) => s + r.coolingBtuLatent, 0).toLocaleString()}</td>
                      <td className="p-4 text-right text-emerald-400 font-mono">{totalCooling.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function NumericField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3 px-4 text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
      />
    </div>
  );
}

function SummaryCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
  const colors: Record<string, string> = {
    orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  };
  const c = colors[color] ?? colors.emerald;

  return (
    <div className="glass-panel rounded-3xl border border-slate-800/60 p-6">
      <div className={`inline-flex p-2.5 rounded-xl border mb-4 ${c}`}>
        {icon}
      </div>
      <p className="text-sm text-slate-400 font-semibold mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{sub}</p>
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
  return (
    <div className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-300">
            {index + 1}
          </span>
          <input
            type="text"
            value={room.name}
            onChange={e => { e.stopPropagation(); onChange({ name: e.target.value }); }}
            onClick={e => e.stopPropagation()}
            className="bg-transparent text-white font-semibold focus:outline-none focus:border-b focus:border-emerald-500 transition-all"
          />
          <span className="text-xs text-slate-500">
            {room.lengthFt}' x {room.widthFt}' x {room.ceilingHeightFt}'
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canRemove && (
            <button
              onClick={e => { e.stopPropagation(); onRemove(); }}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors"
            >
              Remove
            </button>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="p-5 pt-0 border-t border-slate-800/40 animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
            <NumericField label="Length (ft)" value={room.lengthFt} onChange={v => onChange({ lengthFt: v })} />
            <NumericField label="Width (ft)" value={room.widthFt} onChange={v => onChange({ widthFt: v })} />
            <NumericField label="Ceiling Ht (ft)" value={room.ceilingHeightFt} onChange={v => onChange({ ceilingHeightFt: v })} />
            <NumericField label="Exterior Walls" value={room.exteriorWalls} onChange={v => onChange({ exteriorWalls: v })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <NumericField label="Window Area (ft²)" value={room.windowSqFt} onChange={v => onChange({ windowSqFt: v })} />
            <NumericField label="Wall R-Value" value={room.wallRValue} onChange={v => onChange({ wallRValue: v })} />
            <NumericField label="Window U-Value" value={room.windowUValue} onChange={v => onChange({ windowUValue: v })} />
            <NumericField label="Ceiling R-Value" value={room.ceilingRValue} onChange={v => onChange({ ceilingRValue: v })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <NumericField label="Floor R-Value" value={room.floorRValue} onChange={v => onChange({ floorRValue: v })} />
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Floor Type</label>
              <select
                value={room.floorType}
                onChange={e => onChange({ floorType: e.target.value as RoomInput['floorType'] })}
                className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
              >
                <option value="slab">Slab on Grade</option>
                <option value="crawlspace">Crawlspace</option>
                <option value="basement">Basement</option>
                <option value="over_conditioned">Over Conditioned</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Exposure</label>
              <select
                value={room.exposureDirection}
                onChange={e => onChange({ exposureDirection: e.target.value as RoomInput['exposureDirection'] })}
                className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
              >
                {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
