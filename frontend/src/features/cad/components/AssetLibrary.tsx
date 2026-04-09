import { useState, useRef, useCallback } from 'react';
import { X, Search, DoorOpen, LayoutGrid, Wind, Pipette, Box, ChevronRight, Plus, GripVertical } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';

// ── Asset Catalog Data ──────────────────────────────────────────────────────
export interface CatalogAsset {
  id: string;
  name: string;
  category: AssetCategory;
  subcategory: string;
  description: string;
  dimensions: string;
  manufacturer?: string;
  modelNumber?: string;
  specs: Record<string, string>;
  tags: string[];
}

type AssetCategory = 'doors' | 'windows' | 'hvac' | 'piping' | 'fixtures';

const CATEGORY_META: Record<AssetCategory, { label: string; icon: React.ReactNode; color: string }> = {
  doors: { label: 'Doors', icon: <DoorOpen className="w-4 h-4" />, color: 'text-amber-400' },
  windows: { label: 'Windows', icon: <LayoutGrid className="w-4 h-4" />, color: 'text-sky-400' },
  hvac: { label: 'HVAC Equipment', icon: <Wind className="w-4 h-4" />, color: 'text-emerald-400' },
  piping: { label: 'Piping & Duct', icon: <Pipette className="w-4 h-4" />, color: 'text-violet-400' },
  fixtures: { label: 'Fixtures', icon: <Box className="w-4 h-4" />, color: 'text-cyan-400' },
};

const CATALOG: CatalogAsset[] = [
  // ── Doors ─────────────────────────────────────────────────────────────────
  {
    id: 'door-interior-6panel',
    name: '6-Panel Interior Door',
    category: 'doors',
    subcategory: 'Interior',
    description: 'Classic raised 6-panel interior door. Solid core with MDF panels.',
    dimensions: '32" × 80" × 1-3/8"',
    manufacturer: 'Masonite',
    modelNumber: 'MDF-6P-32',
    specs: { 'Core': 'Solid', 'Material': 'MDF / Pine', 'Fire Rating': '20 min', 'STC': '27' },
    tags: ['interior', 'panel', 'standard', 'residential'],
  },
  {
    id: 'door-interior-flush',
    name: 'Flush Interior Door',
    category: 'doors',
    subcategory: 'Interior',
    description: 'Smooth flush door for modern interiors. Hollow or solid core available.',
    dimensions: '30" × 80" × 1-3/8"',
    manufacturer: 'JELD-WEN',
    modelNumber: 'JW-FLS-30',
    specs: { 'Core': 'Hollow', 'Material': 'Hardboard', 'Fire Rating': 'N/A', 'Weight': '28 lbs' },
    tags: ['interior', 'flush', 'modern', 'lightweight'],
  },
  {
    id: 'door-exterior-steel',
    name: 'Steel Entry Door',
    category: 'doors',
    subcategory: 'Exterior',
    description: 'Insulated steel entry door with polyurethane core. Weatherstripped.',
    dimensions: '36" × 80" × 1-3/4"',
    manufacturer: 'Therma-Tru',
    modelNumber: 'TT-STL-36',
    specs: { 'Core': 'Polyurethane', 'U-Factor': '0.17', 'Material': '24-ga Steel', 'Security': 'Deadbolt ready' },
    tags: ['exterior', 'steel', 'insulated', 'entry'],
  },
  {
    id: 'door-sliding-patio',
    name: 'Sliding Patio Door',
    category: 'doors',
    subcategory: 'Patio',
    description: 'Two-panel sliding glass patio door with Low-E glass and aluminum frame.',
    dimensions: '72" × 80"',
    manufacturer: 'Pella',
    modelNumber: 'PL-SLD-72',
    specs: { 'Glass': 'Dual Low-E', 'U-Factor': '0.29', 'SHGC': '0.22', 'Frame': 'Aluminum clad' },
    tags: ['patio', 'sliding', 'glass', 'exterior'],
  },
  {
    id: 'door-fire-rated',
    name: 'Fire-Rated Door',
    category: 'doors',
    subcategory: 'Commercial',
    description: '90-minute fire-rated commercial door with closer and panic hardware.',
    dimensions: '36" × 84" × 1-3/4"',
    manufacturer: 'Curries',
    modelNumber: 'CUR-FR90-36',
    specs: { 'Fire Rating': '90 min', 'Core': 'Mineral', 'Material': '18-ga Steel', 'UL Listed': 'Yes' },
    tags: ['commercial', 'fire-rated', 'steel', 'code'],
  },

  // ── Windows ───────────────────────────────────────────────────────────────
  {
    id: 'window-double-hung',
    name: 'Double-Hung Window',
    category: 'windows',
    subcategory: 'Residential',
    description: 'Traditional double-hung with tilt-in sashes for easy cleaning.',
    dimensions: '36" × 48"',
    manufacturer: 'Andersen',
    modelNumber: 'AND-DH-3648',
    specs: { 'Glass': 'Double Low-E', 'U-Factor': '0.27', 'SHGC': '0.30', 'Frame': 'Vinyl' },
    tags: ['residential', 'double-hung', 'vinyl', 'low-e'],
  },
  {
    id: 'window-casement',
    name: 'Casement Window',
    category: 'windows',
    subcategory: 'Residential',
    description: 'Side-hinged casement window. Excellent ventilation and tight seal when closed.',
    dimensions: '30" × 48"',
    manufacturer: 'Marvin',
    modelNumber: 'MRV-CAS-3048',
    specs: { 'Glass': 'Triple Low-E', 'U-Factor': '0.20', 'SHGC': '0.26', 'Frame': 'Fiberglass' },
    tags: ['residential', 'casement', 'fiberglass', 'energy-star'],
  },
  {
    id: 'window-picture',
    name: 'Picture Window',
    category: 'windows',
    subcategory: 'Fixed',
    description: 'Large fixed picture window for maximum light and views. Non-operable.',
    dimensions: '60" × 48"',
    manufacturer: 'Pella',
    modelNumber: 'PL-PIC-6048',
    specs: { 'Glass': 'Triple Low-E Argon', 'U-Factor': '0.18', 'SHGC': '0.25', 'Frame': 'Wood clad' },
    tags: ['fixed', 'picture', 'large', 'energy-star'],
  },
  {
    id: 'window-egress',
    name: 'Egress Basement Window',
    category: 'windows',
    subcategory: 'Basement',
    description: 'Code-compliant egress window for basement bedrooms. Meets IRC requirements.',
    dimensions: '48" × 44"',
    manufacturer: 'JELD-WEN',
    modelNumber: 'JW-EGR-4844',
    specs: { 'Glass': 'Double Low-E', 'U-Factor': '0.30', 'Opening': '5.7 sq ft net clear', 'Frame': 'Vinyl' },
    tags: ['basement', 'egress', 'code', 'safety'],
  },

  // ── HVAC Equipment ────────────────────────────────────────────────────────
  {
    id: 'hvac-supply-register',
    name: 'Steel Supply Register',
    category: 'hvac',
    subcategory: 'Registers & Grilles',
    description: '2-way steel supply register with adjustable damper. Powder-coated white.',
    dimensions: '10" × 6" × 2"',
    manufacturer: 'Hart & Cooley',
    modelNumber: 'HC-421-10x6',
    specs: { 'CFM': '75-100', 'Material': 'Steel', 'Throw': '8-12 ft', 'Finish': 'White powder coat' },
    tags: ['supply', 'register', 'steel', 'residential'],
  },
  {
    id: 'hvac-return-grille',
    name: 'Return Air Grille',
    category: 'hvac',
    subcategory: 'Registers & Grilles',
    description: 'Fixed-bar return air grille with 45° deflection. Stamped steel face.',
    dimensions: '20" × 20" × 1"',
    manufacturer: 'Hart & Cooley',
    modelNumber: 'HC-650-20x20',
    specs: { 'CFM': '400-600', 'Material': 'Steel', 'Free Area': '80%', 'Finish': 'White' },
    tags: ['return', 'grille', 'steel', 'residential'],
  },
  {
    id: 'hvac-air-handler',
    name: 'Variable-Speed Air Handler',
    category: 'hvac',
    subcategory: 'Air Handlers',
    description: 'Multi-position air handler with ECM blower motor and TXV metering.',
    dimensions: '21" × 24.5" × 51"',
    manufacturer: 'Carrier',
    modelNumber: 'FV4CNF003',
    specs: { 'Tonnage': '2.5-3', 'CFM': '800-1200', 'Motor': 'ECM Variable', 'SEER2': '16+' },
    tags: ['air-handler', 'variable-speed', 'indoor', 'residential'],
  },
  {
    id: 'hvac-condenser',
    name: 'Heat Pump Condenser',
    category: 'hvac',
    subcategory: 'Outdoor Units',
    description: 'Inverter-driven heat pump condenser. Heating down to -15°F.',
    dimensions: '35" × 35" × 40"',
    manufacturer: 'Carrier',
    modelNumber: '25VNA036A003',
    specs: { 'Tonnage': '3', 'SEER2': '24', 'HSPF2': '12', 'Refrigerant': 'R-410A', 'Sound': '56 dB' },
    tags: ['condenser', 'heat-pump', 'inverter', 'outdoor'],
  },
  {
    id: 'hvac-mini-split',
    name: 'Ductless Mini-Split',
    category: 'hvac',
    subcategory: 'Mini-Splits',
    description: 'Wall-mounted ductless mini-split head. Whisper-quiet operation.',
    dimensions: '32" × 11" × 8"',
    manufacturer: 'Mitsubishi',
    modelNumber: 'MSZ-FH12NA',
    specs: { 'BTU': '12,000', 'SEER2': '33.1', 'Sound': '19 dB', 'Zones': '1' },
    tags: ['mini-split', 'ductless', 'wall-mount', 'quiet'],
  },
  {
    id: 'hvac-thermostat',
    name: 'Smart Thermostat',
    category: 'hvac',
    subcategory: 'Controls',
    description: 'Wi-Fi smart thermostat with learning schedule and remote sensor support.',
    dimensions: '4.1" × 4.1" × 1.2"',
    manufacturer: 'Ecobee',
    modelNumber: 'EB-STATE6P-01',
    specs: { 'Display': '3.5" Touch', 'Sensors': '2 included', 'Stages': '2H/2C', 'Protocol': 'Wi-Fi 5' },
    tags: ['thermostat', 'smart', 'wifi', 'sensor'],
  },

  // ── Piping & Duct ─────────────────────────────────────────────────────────
  {
    id: 'duct-round-6',
    name: 'Round Duct — 6"',
    category: 'piping',
    subcategory: 'Round Duct',
    description: '6" round galvanized spiral duct. Branch run for residential supply.',
    dimensions: '6" dia × 60" length',
    manufacturer: 'Lindab',
    modelNumber: 'LDB-SPR-6',
    specs: { 'CFM': '100-150', 'Gauge': '28 ga', 'Material': 'Galvanized steel', 'Velocity': '700 FPM' },
    tags: ['duct', 'round', 'branch', 'supply'],
  },
  {
    id: 'duct-rectangular',
    name: 'Rectangular Trunk Duct',
    category: 'piping',
    subcategory: 'Rectangular Duct',
    description: '12×10 rectangular trunk duct for main supply/return runs.',
    dimensions: '12" × 10" × 48"',
    manufacturer: 'Sheet Metal Connectors',
    modelNumber: 'SMC-RECT-12x10',
    specs: { 'CFM': '400-600', 'Gauge': '26 ga', 'Material': 'Galvanized steel', 'S&D': 'TDC' },
    tags: ['duct', 'rectangular', 'trunk', 'main'],
  },
  {
    id: 'pipe-copper-3/4',
    name: 'Copper Pipe — 3/4" Type L',
    category: 'piping',
    subcategory: 'Refrigerant Line',
    description: '3/4" Type L copper tubing for refrigerant suction line.',
    dimensions: '3/4" OD × 10 ft',
    manufacturer: 'Mueller',
    modelNumber: 'MUL-L-075',
    specs: { 'Type': 'L', 'Wall': '0.045"', 'PSI': '740 @ 100°F', 'Application': 'Suction line' },
    tags: ['copper', 'refrigerant', 'suction', 'lineset'],
  },
  {
    id: 'pipe-pvc-drain',
    name: 'PVC Condensate Drain',
    category: 'piping',
    subcategory: 'Drain',
    description: '3/4" PVC condensate drain line with trap fitting.',
    dimensions: '3/4" × 10 ft',
    manufacturer: 'Charlotte Pipe',
    modelNumber: 'CP-PVC-075',
    specs: { 'Material': 'Schedule 40 PVC', 'Fitting': 'P-trap included', 'Application': 'Condensate' },
    tags: ['pvc', 'condensate', 'drain', 'trap'],
  },

  // ── Fixtures ──────────────────────────────────────────────────────────────
  {
    id: 'fixture-diffuser-round',
    name: 'Round Ceiling Diffuser',
    category: 'fixtures',
    subcategory: 'Diffusers',
    description: '360° round ceiling diffuser with adjustable cone pattern.',
    dimensions: '12" face × 8" neck',
    manufacturer: 'Titus',
    modelNumber: 'TIT-DERA-12',
    specs: { 'CFM': '150-250', 'Pattern': '1-4 way', 'NC': '25', 'Material': 'Aluminum' },
    tags: ['diffuser', 'round', 'ceiling', 'commercial'],
  },
  {
    id: 'fixture-flex-duct',
    name: 'Insulated Flex Duct',
    category: 'fixtures',
    subcategory: 'Flex Duct',
    description: '6" insulated flexible duct for branch connections to registers.',
    dimensions: '6" × 25 ft',
    manufacturer: 'Dundas Jafine',
    modelNumber: 'DJ-FLEX-6',
    specs: { 'R-Value': 'R-8', 'Core': 'Aluminized polyester', 'Insulation': 'Fiberglass', 'UL': '181 Class 1' },
    tags: ['flex', 'duct', 'insulated', 'branch'],
  },
];

// ── Component ───────────────────────────────────────────────────────────────
interface AssetLibraryProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AssetLibrary({ isOpen, onClose }: AssetLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<AssetCategory | 'all'>('all');
  const [selectedAsset, setSelectedAsset] = useState<CatalogAsset | null>(null);
  const [panelWidth, setPanelWidth] = useState(380);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const handlePlaceOnCanvas = useCallback((asset: CatalogAsset) => {
    const state = useCadStore.getState();
    const cat = asset.category;

    if (cat === 'doors') {
      state.setActiveTool('place_door');
    } else if (cat === 'windows') {
      state.setActiveTool('place_window');
    } else if (cat === 'hvac' || cat === 'piping' || cat === 'fixtures') {
      state.setActiveTool('place_hvac');
    }
    onClose();
  }, [onClose]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      // Dragging right = expand (positive delta)
      const delta = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(320, Math.min(900, resizeRef.current.startW + delta));
      setPanelWidth(newW);
    };
    const handleUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [panelWidth]);

  if (!isOpen) return null;

  const filtered = CATALOG.filter((a) => {
    if (activeCategory !== 'all' && a.category !== activeCategory) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some((t) => t.includes(q)) ||
      a.manufacturer?.toLowerCase().includes(q) ||
      a.modelNumber?.toLowerCase().includes(q)
    );
  });

  const categories: (AssetCategory | 'all')[] = ['all', 'doors', 'windows', 'hvac', 'piping', 'fixtures'];

  return (
    <div
      className="fixed top-0 left-[72px] bottom-0 z-[95] flex pointer-events-auto"
      style={{ width: panelWidth }}
    >
      <div className="flex-1 glass-panel flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.7)] border-r border-slate-700/50 backdrop-blur-xl bg-slate-900/95 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/60 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-100 tracking-wide flex items-center gap-2">
              <Box className="w-4 h-4 text-emerald-400" />
              Asset Library
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5">{CATALOG.length} assets</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Categories */}
        <div className="px-4 py-3 border-b border-slate-800/50 flex-shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-600"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => {
              const isAll = cat === 'all';
              const meta = isAll ? null : CATEGORY_META[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border ${
                    activeCategory === cat
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-slate-950/50 text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {isAll ? 'All' : (
                    <>
                      <span className={meta!.color}>{meta!.icon}</span>
                      {meta!.label}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {selectedAsset ? (
            <div className="p-4 space-y-4">
              <button
                onClick={() => setSelectedAsset(null)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              >
                ← Back
              </button>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={CATEGORY_META[selectedAsset.category].color}>
                    {CATEGORY_META[selectedAsset.category].icon}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                    {selectedAsset.subcategory}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-100">{selectedAsset.name}</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{selectedAsset.description}</p>
              </div>

              {/* Specs */}
              <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-3">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Specifications</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[9px] text-slate-600 uppercase">Dimensions</span>
                    <p className="text-xs text-slate-200 font-mono">{selectedAsset.dimensions}</p>
                  </div>
                  {selectedAsset.manufacturer && (
                    <div>
                      <span className="text-[9px] text-slate-600 uppercase">Manufacturer</span>
                      <p className="text-xs text-slate-200">{selectedAsset.manufacturer}</p>
                    </div>
                  )}
                  {selectedAsset.modelNumber && (
                    <div>
                      <span className="text-[9px] text-slate-600 uppercase">Model</span>
                      <p className="text-xs text-slate-200 font-mono">{selectedAsset.modelNumber}</p>
                    </div>
                  )}
                  {Object.entries(selectedAsset.specs).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-[9px] text-slate-600 uppercase">{key}</span>
                      <p className="text-xs text-slate-200">{val}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                {selectedAsset.tags.map((tag) => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-500 font-mono">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Place button */}
              <button
                onClick={() => handlePlaceOnCanvas(selectedAsset)}
                className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Place on Canvas
              </button>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {filtered.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-slate-500 text-xs">No assets match your search.</p>
                </div>
              ) : (
                filtered.map((asset) => {
                  const meta = CATEGORY_META[asset.category];
                  return (
                    <button
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-800/40 transition-colors text-left group"
                    >
                      <div className={`w-8 h-8 rounded-lg bg-slate-800/60 border border-slate-700/50 flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-200 truncate block">{asset.name}</span>
                        <p className="text-[10px] text-slate-500 truncate">{asset.dimensions} — {asset.subcategory}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/50 flex-shrink-0">
          <p className="text-[9px] text-slate-600 text-center font-medium">
            {filtered.length} asset{filtered.length !== 1 ? 's' : ''} — Drag panel edge to resize
          </p>
        </div>
      </div>

      {/* Resize handle — right edge */}
      <div
        onMouseDown={handleResizeStart}
        className="w-2 cursor-col-resize flex items-center justify-center hover:bg-emerald-500/20 transition-colors group flex-shrink-0"
        title="Drag to resize"
      >
        <GripVertical className="w-3 h-3 text-slate-700 group-hover:text-emerald-400 transition-colors" />
      </div>
    </div>
  );
}
