/**
 * Spotlight Search — Cmd+K / Ctrl+K global search overlay
 *
 * Indexes:
 *  1. Saved projects (localStorage hvac_projects)
 *  2. App pages & actions (calculator, CAD, settings, etc.)
 *  3. Preferred HVAC retailers (Howland Pump & Supply, Hulbert Supply, C O Supply)
 *  4. HVAC tools & equipment catalog
 *  5. Local files (via File System Access API if available)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, FileText, Home, Thermometer, PenTool, Settings, Users, Sun, GitBranch,
  MapPin, Star, Wrench, Package, Navigation,
  ArrowRight, FolderOpen, Zap, Gauge, FileDown, Shield
} from 'lucide-react';
import { ALL_RETAILERS } from '../retailer/data/retailers';
import { getDirectionsUrl } from '../retailer/utils/geolocation';
import { scopedKey } from '../../utils/storage';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type ResultCategory = 'project' | 'page' | 'retailer' | 'tool' | 'file' | 'action' | 'shortcut' | 'help' | 'room';

interface SearchResult {
  id: string;
  category: ResultCategory;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  preferred?: boolean;
  action: () => void;
  // for external links
  href?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP PAGES INDEX
// ═══════════════════════════════════════════════════════════════════════════════

function getPageResults(navigate: (path: string) => void): SearchResult[] {
  return [
    { id: 'page-dashboard', category: 'page', title: 'Project Workspace', subtitle: 'Dashboard — manage projects', icon: <Home className="w-4 h-4" />, action: () => navigate('/dashboard') },
    { id: 'page-calculator', category: 'page', title: 'Manual J Calculator', subtitle: 'Heating & cooling load calculations', icon: <Thermometer className="w-4 h-4" />, action: () => navigate('/calculator') },
    { id: 'page-manuald', category: 'page', title: 'Manual D Calculator', subtitle: 'Duct sizing & friction rate design', icon: <GitBranch className="w-4 h-4" />, action: () => navigate('/manual-d') },
    { id: 'page-aed', category: 'page', title: 'AED Analysis', subtitle: 'Adequate Exposure Diversity — Section N', icon: <Sun className="w-4 h-4" />, action: () => navigate('/aed') },
    { id: 'page-cad', category: 'page', title: 'CAD Workspace', subtitle: 'Floor plan design & duct layout', icon: <PenTool className="w-4 h-4" />, action: () => navigate('/cad') },
    { id: 'page-settings', category: 'page', title: 'Settings', subtitle: 'Theme, units, preferences', icon: <Settings className="w-4 h-4" />, action: () => navigate('/settings') },
    { id: 'page-team', category: 'page', title: 'Team Management', subtitle: 'Manage team members', icon: <Users className="w-4 h-4" />, action: () => navigate('/team') },
    { id: 'page-terms', category: 'page', title: 'Terms of Service', subtitle: 'C4 Technologies legal terms', icon: <Shield className="w-4 h-4" />, action: () => navigate('/terms') },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// HVAC TOOLS & EQUIPMENT CATALOG
// ═══════════════════════════════════════════════════════════════════════════════

interface ToolEntry {
  id: string;
  name: string;
  category: string;
  keywords: string[];
}

const HVAC_TOOLS: ToolEntry[] = [
  { id: 'tool-manifold', name: 'Refrigerant Manifold Gauge Set', category: 'Diagnostic', keywords: ['gauges', 'manifold', 'refrigerant', 'r410a', 'r22', 'charging', 'pressure'] },
  { id: 'tool-vacuum', name: 'Vacuum Pump (2-Stage)', category: 'Installation', keywords: ['vacuum', 'pump', 'evacuation', 'micron'] },
  { id: 'tool-recovery', name: 'Refrigerant Recovery Machine', category: 'Service', keywords: ['recovery', 'reclaim', 'refrigerant', 'tank'] },
  { id: 'tool-leak', name: 'Electronic Leak Detector', category: 'Diagnostic', keywords: ['leak', 'detector', 'refrigerant', 'halide'] },
  { id: 'tool-manometer', name: 'Digital Manometer', category: 'Diagnostic', keywords: ['manometer', 'pressure', 'static', 'duct'] },
  { id: 'tool-anemometer', name: 'Anemometer / Airflow Meter', category: 'Diagnostic', keywords: ['anemometer', 'airflow', 'cfm', 'velocity', 'balancing'] },
  { id: 'tool-psychrometer', name: 'Digital Psychrometer', category: 'Diagnostic', keywords: ['psychrometer', 'humidity', 'wet bulb', 'dry bulb', 'rh'] },
  { id: 'tool-combustion', name: 'Combustion Analyzer', category: 'Diagnostic', keywords: ['combustion', 'analyzer', 'co', 'flue', 'gas', 'efficiency'] },
  { id: 'tool-multimeter', name: 'HVAC Multimeter (True RMS)', category: 'Electrical', keywords: ['multimeter', 'voltage', 'amp', 'ohm', 'capacitor', 'electrical'] },
  { id: 'tool-clamp', name: 'Clamp Meter', category: 'Electrical', keywords: ['clamp', 'meter', 'amp', 'current', 'inrush'] },
  { id: 'tool-megohm', name: 'Megohmmeter / Insulation Tester', category: 'Electrical', keywords: ['megohm', 'insulation', 'compressor', 'motor', 'winding'] },
  { id: 'tool-brazing', name: 'Brazing Torch Kit (Oxy-Acetylene)', category: 'Installation', keywords: ['brazing', 'torch', 'solder', 'copper', 'pipe', 'oxy'] },
  { id: 'tool-flaring', name: 'Flaring Tool Set', category: 'Installation', keywords: ['flaring', 'flare', 'copper', 'fitting', 'tube'] },
  { id: 'tool-swaging', name: 'Swaging Tool Kit', category: 'Installation', keywords: ['swaging', 'swage', 'copper', 'pipe', 'expand'] },
  { id: 'tool-tubecutter', name: 'Tube Cutter Set', category: 'Installation', keywords: ['cutter', 'tube', 'copper', 'pipe'] },
  { id: 'tool-nitro', name: 'Nitrogen Regulator & Flow Kit', category: 'Installation', keywords: ['nitrogen', 'purge', 'brazing', 'regulator', 'pressure test'] },
  { id: 'tool-scales', name: 'Refrigerant Scale (Digital)', category: 'Service', keywords: ['scale', 'weight', 'refrigerant', 'charging'] },
  { id: 'tool-ductboard', name: 'Duct Board Cutting Tools', category: 'Ductwork', keywords: ['duct', 'board', 'fiberglass', 'cutting', 'knife'] },
  { id: 'tool-crimper', name: 'Sheet Metal Crimper', category: 'Ductwork', keywords: ['crimper', 'sheet metal', 'duct', 'fitting'] },
  { id: 'tool-seamer', name: 'Hand Seamer / Tongs', category: 'Ductwork', keywords: ['seamer', 'tongs', 'sheet metal', 'duct'] },
  { id: 'tool-levelaser', name: 'Laser Level (Self-Leveling)', category: 'Installation', keywords: ['laser', 'level', 'alignment', 'mounting'] },
  { id: 'tool-thermal', name: 'Thermal Imaging Camera', category: 'Diagnostic', keywords: ['thermal', 'imaging', 'camera', 'infrared', 'heat', 'insulation'] },
  { id: 'tool-blower', name: 'Blower Door Test Kit', category: 'Diagnostic', keywords: ['blower', 'door', 'infiltration', 'ach', 'air sealing', 'envelope'] },
  { id: 'equip-condenser', name: 'Condensing Unit (Residential)', category: 'Equipment', keywords: ['condenser', 'condensing', 'unit', 'outdoor', 'compressor', 'ac'] },
  { id: 'equip-handler', name: 'Air Handler', category: 'Equipment', keywords: ['air handler', 'indoor unit', 'blower', 'coil', 'evaporator'] },
  { id: 'equip-furnace', name: 'Gas Furnace', category: 'Equipment', keywords: ['furnace', 'gas', 'heating', 'burner', 'heat exchanger'] },
  { id: 'equip-heatpump', name: 'Heat Pump System', category: 'Equipment', keywords: ['heat pump', 'mini split', 'ductless', 'inverter', 'variable speed'] },
  { id: 'equip-thermostat', name: 'Smart Thermostat', category: 'Controls', keywords: ['thermostat', 'smart', 'wifi', 'programmable', 'nest', 'ecobee'] },
  { id: 'equip-filter', name: 'MERV-13 Air Filter', category: 'Filtration', keywords: ['filter', 'merv', 'air quality', 'filtration', 'media'] },
  { id: 'equip-uv', name: 'UV-C Air Purifier', category: 'IAQ', keywords: ['uv', 'purifier', 'iaq', 'germicidal', 'air quality'] },
  { id: 'equip-erv', name: 'Energy Recovery Ventilator (ERV)', category: 'Ventilation', keywords: ['erv', 'hrv', 'ventilator', 'recovery', 'fresh air', 'ashrae 62.2'] },
  { id: 'equip-dehumidifier', name: 'Whole-House Dehumidifier', category: 'IAQ', keywords: ['dehumidifier', 'humidity', 'moisture', 'latent'] },
  { id: 'equip-zoning', name: 'Zone Damper System', category: 'Controls', keywords: ['zone', 'damper', 'zoning', 'multi-zone', 'bypass'] },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;

  // Simple fuzzy: all chars of query appear in order in text
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function scoreMatch(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 70;
  return 30; // fuzzy match
}

function searchAll(
  query: string,
  navigate: (path: string) => void,
): SearchResult[] {
  if (!query.trim()) return [];

  const q = query.trim();
  const results: SearchResult[] = [];

  // 1. Search saved projects
  try {
    const raw = localStorage.getItem(scopedKey('hvac_projects'));
    if (raw) {
      const projects = JSON.parse(raw) as { id: string; name: string; address: string; city: string; status: string }[];
      projects.forEach(p => {
        const searchText = `${p.name} ${p.address} ${p.city}`;
        if (fuzzyMatch(q, searchText)) {
          results.push({
            id: `proj-${p.id}`,
            category: 'project',
            title: p.name,
            subtitle: `${p.address}, ${p.city} — ${p.status}`,
            icon: <FileText className="w-4 h-4" />,
            action: () => navigate(`/project/${p.id}/cad`),
          });
        }
      });
    }
  } catch { /* ignore localStorage errors */ }

  // 2. Search app pages
  getPageResults(navigate).forEach(page => {
    if (fuzzyMatch(q, `${page.title} ${page.subtitle ?? ''}`)) {
      results.push(page);
    }
  });

  // 3. Search retailers — preferred always boosted
  ALL_RETAILERS.forEach(r => {
    const searchText = `${r.name} ${r.address.city} ${r.address.state} ${r.capabilities.join(' ')} hvac supply store`;
    if (fuzzyMatch(q, searchText)) {
      results.push({
        id: `retailer-${r.id}`,
        category: 'retailer',
        title: r.name,
        subtitle: `${r.address.city}, ${r.address.state} — ${r.phone}`,
        icon: <MapPin className="w-4 h-4" />,
        preferred: r.preferred,
        href: getDirectionsUrl(r),
        action: () => window.open(getDirectionsUrl(r), '_blank'),
      });
    }
  });

  // 4. Search HVAC tools & equipment
  HVAC_TOOLS.forEach(tool => {
    const searchText = `${tool.name} ${tool.category} ${tool.keywords.join(' ')}`;
    if (fuzzyMatch(q, searchText)) {
      results.push({
        id: `tool-${tool.id}`,
        category: 'tool',
        title: tool.name,
        subtitle: tool.category,
        icon: tool.id.startsWith('equip-') ? <Package className="w-4 h-4" /> : <Wrench className="w-4 h-4" />,
        action: () => {
          // Search preferred retailers for this tool
          const preferred = ALL_RETAILERS.filter(r => r.preferred);
          if (preferred.length > 0) {
            const url = getDirectionsUrl(preferred[0]);
            window.open(url, '_blank');
          }
        },
      });
    }
  });

  // 5. Actions (quick commands)
  const actions: SearchResult[] = [
    { id: 'action-calc', category: 'action', title: 'Run Manual J Calculation', subtitle: 'Open calculator and compute loads', icon: <Zap className="w-4 h-4" />, action: () => navigate('/calculator') },
    { id: 'action-newproject', category: 'action', title: 'Create New Project', subtitle: 'Start a new HVAC project', icon: <FolderOpen className="w-4 h-4" />, action: () => navigate('/dashboard') },
    { id: 'action-export', category: 'action', title: 'Export PDF Report', subtitle: 'Generate Manual J report PDF', icon: <FileDown className="w-4 h-4" />, action: () => navigate('/calculator') },
    { id: 'action-findretailer', category: 'action', title: 'Find Nearest HVAC Supply', subtitle: 'Howland Pump & Supply, C O Supply, Hulbert Supply', icon: <Navigation className="w-4 h-4" />, action: () => navigate('/calculator') },
    { id: 'action-duct', category: 'action', title: 'Duct Design', subtitle: 'Open CAD workspace for duct layout', icon: <Gauge className="w-4 h-4" />, action: () => navigate('/cad') },
  ];
  actions.forEach(a => {
    if (fuzzyMatch(q, `${a.title} ${a.subtitle ?? ''}`)) {
      results.push(a);
    }
  });

  // 6. Keyboard shortcuts
  const shortcuts = [
    { key: 'V', desc: 'Select tool', ctx: 'CAD' }, { key: 'H', desc: 'Pan / Hand tool', ctx: 'CAD' },
    { key: 'W', desc: 'Draw wall', ctx: 'CAD' }, { key: 'D', desc: 'Dimension tool', ctx: 'CAD' },
    { key: 'L', desc: 'Add label / text', ctx: 'CAD' }, { key: 'R', desc: 'Detect rooms', ctx: 'CAD' },
    { key: 'G', desc: 'Toggle grid snap', ctx: 'CAD' }, { key: 'T', desc: 'Toggle toolbox', ctx: 'CAD' },
    { key: 'P', desc: 'Toggle properties', ctx: 'CAD' }, { key: 'F', desc: 'Toggle floors panel', ctx: 'CAD' },
    { key: 'Ctrl+Z', desc: 'Undo', ctx: 'Global' }, { key: 'Ctrl+Y', desc: 'Redo', ctx: 'Global' },
    { key: 'Ctrl+S', desc: 'Save project', ctx: 'CAD' }, { key: 'Ctrl+E', desc: 'Export PDF', ctx: 'CAD' },
    { key: 'Ctrl+K', desc: 'Spotlight search', ctx: 'Global' }, { key: 'Alt+M', desc: 'Toggle Mason AI', ctx: 'Global' },
    { key: 'Escape', desc: 'Cancel / deselect', ctx: 'Global' }, { key: 'Delete', desc: 'Delete selected', ctx: 'CAD' },
  ];
  shortcuts.forEach(s => {
    if (fuzzyMatch(q, `${s.key} ${s.desc} shortcut keyboard hotkey keybind ${s.ctx}`)) {
      results.push({
        id: `shortcut-${s.key}`,
        category: 'shortcut',
        title: `${s.key}`,
        subtitle: `${s.desc} (${s.ctx})`,
        icon: <Zap className="w-4 h-4" />,
        action: () => { /* no-op — informational */ },
      });
    }
  });

  // 7. Mason help topics (searchable KB)
  const masonTopics = [
    { q: 'manual j load calculation', title: 'Manual J Basics', sub: 'What is Manual J and how it works' },
    { q: 'measure rooms dimensions', title: 'How to Measure Rooms', sub: 'Room dimensions for load calcs' },
    { q: 'window area glass fenestration', title: 'Window Measurements', sub: 'Window sizing for Manual J' },
    { q: 'r-value insulation wall', title: 'R-Value Guide', sub: 'Identifying wall & ceiling insulation' },
    { q: 'duct sizing manual d friction', title: 'Duct Sizing Basics', sub: 'Manual D duct design fundamentals' },
    { q: 'cfm airflow distribution', title: 'CFM Distribution', sub: 'How airflow is allocated to rooms' },
    { q: 'internal load appliance room type', title: 'Internal Loads', sub: 'Room types, appliances & heat sources' },
    { q: 'project isolation switch', title: 'Project Management', sub: 'Creating and switching between projects' },
    { q: 'feedback bug report idea', title: 'Submit Feedback', sub: 'Report bugs or suggest features via Mason' },
    { q: 'session persist workspace restore', title: 'Session Persistence', sub: 'Workspace state saves between sessions' },
    { q: 'keyboard shortcuts cad', title: 'Keyboard Shortcuts', sub: 'All CAD workspace hotkeys' },
    { q: 'pdf export print report', title: 'PDF Reports', sub: 'Export and customize PDF documents' },
    { q: '3d view orbit pan zoom', title: '3D Viewer', sub: '3D building visualization controls' },
  ];
  masonTopics.forEach(t => {
    if (fuzzyMatch(q, `${t.q} ${t.title} ${t.sub} mason help ask`)) {
      results.push({
        id: `help-${t.title}`,
        category: 'help',
        title: `Ask Mason: ${t.title}`,
        subtitle: t.sub,
        icon: <Zap className="w-4 h-4 text-amber-400" />,
        action: () => {
          // Dispatch topic to Mason by simulating Alt+M then setting input
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true }));
        },
      });
    }
  });

  // 8. Search Manual J rooms in active project
  try {
    const projRaw = localStorage.getItem(scopedKey('hvac_projects'));
    if (projRaw) {
      const projects = JSON.parse(projRaw);
      // Check each project for Manual J rooms
      for (const proj of projects) {
        const mjRaw = localStorage.getItem(scopedKey(`hvac_manualj_inputs_${proj.id}`));
        if (!mjRaw) continue;
        const mj = JSON.parse(mjRaw);
        if (!mj.rooms) continue;
        for (const room of mj.rooms) {
          const searchText = `${room.name} ${room.roomType || ''} ${room.floorName || ''} ${proj.name}`;
          if (fuzzyMatch(q, searchText)) {
            const area = (room.lengthFt || 0) * (room.widthFt || 0);
            results.push({
              id: `room-${proj.id}-${room.id}`,
              category: 'room',
              title: room.name,
              subtitle: `${area} sqft · ${room.floorName || 'Floor 1'} · ${proj.name}`,
              icon: <Home className="w-4 h-4" />,
              action: () => {
                // Set active project and navigate to calculator
                try {
                  const raw = localStorage.getItem(scopedKey('hvac_projects'));
                  if (raw) {
                    // Signal project selection via localStorage (the calculator will pick it up)
                    localStorage.setItem(scopedKey('hvac_spotlight_project'), proj.id);
                  }
                } catch { /* */ }
                navigate('/calculator');
              },
            });
          }
        }
      }
    }
  } catch { /* */ }

  // 9. Settings sections
  const settingsSections = [
    { q: 'theme dark light midnight appearance', title: 'Appearance Settings', sub: 'Theme, density, animations' },
    { q: 'units imperial metric measurement', title: 'Units & Defaults', sub: 'Unit system and default values' },
    { q: 'pdf print watermark stamp seal', title: 'PDF & Print Settings', sub: 'Page size, sections, watermark, stamps' },
    { q: 'firm stamp pe seal notary', title: 'Blueprint Stamps', sub: 'Upload PE seal and notary stamp' },
    { q: 'grid snap autosave cad workspace', title: 'CAD Workspace Settings', sub: 'Grid, snap, auto-save' },
    { q: 'accessibility a11y', title: 'Accessibility', sub: 'Screen reader and visual accessibility' },
  ];
  settingsSections.forEach(s => {
    if (fuzzyMatch(q, `${s.q} ${s.title} settings preferences config`)) {
      results.push({
        id: `settings-${s.title}`,
        category: 'page',
        title: s.title,
        subtitle: s.sub,
        icon: <Settings className="w-4 h-4" />,
        action: () => navigate('/settings'),
      });
    }
  });

  // Sort: preferred retailers first, then by score, then by category priority
  const categoryOrder: Record<ResultCategory, number> = {
    project: 0, action: 1, room: 2, page: 3, help: 4, shortcut: 5, retailer: 6, tool: 7, file: 8,
  };

  return results.sort((a, b) => {
    // Preferred retailers get huge boost
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;

    const scoreA = scoreMatch(q, a.title);
    const scoreB = scoreMatch(q, b.title);
    if (scoreA !== scoreB) return scoreB - scoreA;

    return categoryOrder[a.category] - categoryOrder[b.category];
  }).slice(0, 20); // cap at 20 results
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function SpotlightSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const results = useMemo(() => searchAll(query, navigate), [query, navigate]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(0); }, [results]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      results[selectedIndex].action();
      setOpen(false);
    }
  }, [results, selectedIndex]);

  if (!open) return null;

  const categoryLabels: Record<ResultCategory, string> = {
    project: 'Projects',
    page: 'Pages',
    retailer: 'HVAC Supply',
    tool: 'Tools & Equipment',
    file: 'Files',
    action: 'Quick Actions',
    shortcut: 'Keyboard Shortcuts',
    help: 'Ask Mason',
    room: 'Rooms',
  };

  const categoryColors: Record<ResultCategory, string> = {
    project: 'text-sky-400',
    page: 'text-slate-400',
    retailer: 'text-amber-400',
    tool: 'text-violet-400',
    file: 'text-emerald-400',
    action: 'text-emerald-400',
    shortcut: 'text-cyan-400',
    help: 'text-amber-400',
    room: 'text-orange-400',
  };

  // Group results by category for display
  let lastCategory: ResultCategory | null = null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] sm:pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Search Panel */}
      <div className="relative w-[95vw] max-w-xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-slate-800/60">
          <Search className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects, tools, stores, pages..."
            className="flex-1 bg-transparent text-white text-sm sm:text-base placeholder-slate-500 focus:outline-none min-h-[44px]"
          />
          <div className="hidden sm:flex items-center gap-1.5">
            <kbd className="text-[10px] text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-mono">ESC</kbd>
          </div>
          <button onClick={() => setOpen(false)} className="sm:hidden p-1 text-slate-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {query && results.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-slate-500">No results for "{query}"</p>
              <p className="text-xs text-slate-600 mt-1">Try searching for projects, tools, stores, or pages</p>
            </div>
          )}

          {results.map((result, i) => {
            const showHeader = result.category !== lastCategory;
            lastCategory = result.category;

            return (
              <div key={result.id}>
                {showHeader && (
                  <div className="px-4 sm:px-5 pt-3 pb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${categoryColors[result.category]}`}>
                      {categoryLabels[result.category]}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => { result.action(); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left transition-colors min-h-[48px] ${
                    i === selectedIndex
                      ? 'bg-emerald-500/10 text-white'
                      : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <div className={`flex-shrink-0 p-1.5 rounded-lg ${
                    result.preferred
                      ? 'bg-amber-500/10 text-amber-400'
                      : i === selectedIndex
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-800 text-slate-400'
                  }`}>
                    {result.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {result.preferred && (
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                      )}
                      <p className="text-sm font-medium truncate">{result.title}</p>
                    </div>
                    {result.subtitle && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">{result.subtitle}</p>
                    )}
                  </div>
                  <ArrowRight className={`w-4 h-4 flex-shrink-0 transition-opacity ${i === selectedIndex ? 'opacity-100 text-emerald-400' : 'opacity-0'}`} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {!query && (
          <div className="px-4 sm:px-5 py-4 border-t border-slate-800/60">
            <p className="text-xs text-slate-600 text-center">
              Search for projects, HVAC tools, supply stores, or pages.
              <span className="hidden sm:inline"> Press <kbd className="text-slate-500 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono text-[10px] mx-1">Ctrl</kbd>+<kbd className="text-slate-500 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono text-[10px]">K</kbd> anytime.</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SpotlightTrigger — Floating search button for mobile.
 * On desktop, users use Cmd+K. On mobile, they tap this button.
 */
export function SpotlightTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
      className="fixed bottom-6 right-6 z-[90] md:hidden w-14 h-14 rounded-2xl bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30 flex items-center justify-center hover:bg-emerald-400 active:scale-95 transition-all"
      aria-label="Search"
    >
      <Search className="w-6 h-6" />
    </button>
  );
}
