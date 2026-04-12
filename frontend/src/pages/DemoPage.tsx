import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass, ArrowRight, ArrowLeft, PenTool, Calculator, Box, FileText,
  Smartphone, Zap, CheckCircle2, Layers, Thermometer, DollarSign,
  MousePointer, Move, Ruler, Home as HomeIcon, Building2
} from 'lucide-react';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to HVAC DesignPro',
    subtitle: 'The complete HVAC engineering platform — built for everyone.',
    description: 'Whether you\'re a seasoned mechanical engineer, a first-year apprentice, or a homeowner curious about your system, DesignPro makes professional HVAC design accessible to all. Let\'s take a quick tour.',
    icon: Compass,
    color: 'emerald',
    visual: 'hero',
  },
  {
    id: 'cad',
    title: 'Draw Floor Plans in Seconds',
    subtitle: 'Professional CAD tools — no AutoCAD required.',
    description: 'Click to draw walls, place doors and windows, drop HVAC equipment, and add dimensions. Multi-floor support, snap-to-grid, undo/redo — everything you need in a browser. Works on desktop, tablet, or phone.',
    icon: PenTool,
    color: 'emerald',
    visual: 'cad',
    features: ['Draw walls with a click', 'Place doors, windows, HVAC units', '9 tools with keyboard shortcuts', 'Multi-floor with layer control', 'Import floor plan images to trace'],
  },
  {
    id: 'calc',
    title: 'Manual J Load Calculations',
    subtitle: 'ACCA-compliant — room by room, the right way.',
    description: 'Enter your rooms, walls, windows, and orientation. DesignPro calculates heating and cooling loads using the ACCA Manual J 8th Edition method — the same standard used by licensed engineers for permit submittals.',
    icon: Calculator,
    color: 'orange',
    visual: 'calc',
    features: ['Room-by-room heating & cooling loads', 'Solar heat gain by orientation', 'Duct loss calculations (ACCA Table 7)', 'Infiltration and ventilation (ASHRAE 62.2)', 'Equipment sizing in BTU/h and tons'],
  },
  {
    id: '3d',
    title: 'See Your Design in 3D',
    subtitle: 'From floor plan to walkthrough — instantly.',
    description: 'Your 2D floor plan converts to an interactive 3D model automatically. See doors with brass handles, windows with mullion grids, duct runs, and HVAC equipment rendered in real time. Export to STL or OBJ for 3D printing or further modeling.',
    icon: Box,
    color: 'sky',
    visual: '3d',
    features: ['Automatic 2D → 3D conversion', 'Realistic procedural models', 'Orbit, zoom, and pan controls', 'Import STL, OBJ, GLTF, FBX models', 'Export for 3D printing'],
  },
  {
    id: 'cost',
    title: 'Know Your Costs Before You Start',
    subtitle: 'Equipment + labor + materials — all estimated.',
    description: 'Based on your load calculations and equipment selections, get instant cost estimates with low-to-high ranges. See line-item breakdowns by system type, ductwork location, and labor complexity.',
    icon: DollarSign,
    color: 'amber',
    visual: 'cost',
    features: ['4 system types compared side-by-side', 'Equipment cost by tonnage', 'Ductwork and labor line items', 'Tax and regional multipliers', 'Low/mid/high range estimates'],
  },
  {
    id: 'reports',
    title: 'Professional PDF Reports',
    subtitle: 'Ready for permits, clients, and your files.',
    description: 'Export multi-page PDF reports with project metadata, floor plans, room schedules, window/door schedules, thermal summaries, and cost breakdowns. Title-block formatted for professional submittals.',
    icon: FileText,
    color: 'violet',
    visual: 'reports',
    features: ['Multi-page professional layout', 'Floor plan with dimensions', 'Room and equipment schedules', 'Thermal and cost summaries', 'One-click export'],
  },
  {
    id: 'anywhere',
    title: 'Works Everywhere — Even Offline',
    subtitle: 'Install on any device. No internet? No problem.',
    description: 'DesignPro is a Progressive Web App. Install it on your phone, tablet, or desktop and use it on a job site with no internet. Your work saves locally and syncs to the cloud when you\'re back online.',
    icon: Smartphone,
    color: 'rose',
    visual: 'pwa',
    features: ['Install like a native app', 'Full offline capability', 'Runs on phone, tablet, desktop', 'Cloud sync when connected', 'Sub-second load times'],
  },
  {
    id: 'start',
    title: 'Ready to Build Something?',
    subtitle: 'Create your free account in under 60 seconds.',
    description: 'Join engineers, contractors, and design professionals already using DesignPro to modernize HVAC design. Free to start. No credit card required.',
    icon: Zap,
    color: 'emerald',
    visual: 'cta',
  },
];

export default function DemoPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const step = STEPS[currentStep];

  const colorMap: Record<string, { accent: string; bg: string; border: string; text: string }> = {
    emerald: { accent: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-300' },
    orange:  { accent: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-300'  },
    sky:     { accent: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     text: 'text-sky-300'     },
    amber:   { accent: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-300'   },
    violet:  { accent: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-300'  },
    rose:    { accent: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-300'    },
  };
  const c = colorMap[step.color];
  const Icon = step.icon;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-emerald-500/30 overflow-y-auto">

      {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/40">
        <div className="flex items-center justify-between px-6 py-3 max-w-5xl mx-auto">
          <Link to="/" className="flex items-center gap-2">
            <Compass className="w-6 h-6 text-emerald-400" />
            <span className="text-base font-bold premium-gradient-text">HVAC DesignPro</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition-colors px-4 py-2">
              Sign In
            </Link>
            <Link to="/onboarding" className="bg-emerald-500 text-slate-950 px-5 py-2 rounded-full text-sm font-bold hover:bg-emerald-400 transition-all">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Progress dots */}
      <div className="max-w-5xl mx-auto px-6 pt-8">
        <div className="flex items-center gap-2 mb-2">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(i)}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === currentStep
                  ? 'w-8 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                  : i < currentStep
                  ? 'w-4 bg-emerald-500/40'
                  : 'w-4 bg-slate-800'
              }`}
            />
          ))}
          <span className="ml-auto text-xs text-slate-600 font-mono">{currentStep + 1} / {STEPS.length}</span>
        </div>
      </div>

      {/* Step Content */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div key={step.id} className="animate-in fade-in slide-in-from-right-4 duration-500">

          {/* Header */}
          <div className="flex items-start gap-5 mb-8">
            <div className={`w-14 h-14 rounded-2xl ${c.bg} border ${c.border} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-7 h-7 ${c.accent}`} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-1">{step.title}</h1>
              <p className={`text-lg font-medium ${c.text}`}>{step.subtitle}</p>
            </div>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">{step.description}</p>

              {step.features && (
                <ul className="space-y-3">
                  {step.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className={`w-5 h-5 ${c.accent} flex-shrink-0 mt-0.5`} />
                      <span className="text-slate-300 font-medium">{f}</span>
                    </li>
                  ))}
                </ul>
              )}

              {step.visual === 'cta' && (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link to="/onboarding" className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-8 py-4 rounded-full font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] transition-all">
                    Create Free Account <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link to="/login" className="flex items-center gap-2 px-8 py-4 rounded-full font-bold text-slate-300 border border-slate-700 hover:border-slate-500 hover:text-white transition-all">
                    Sign In
                  </Link>
                </div>
              )}
            </div>

            {/* Visual / Illustration */}
            <div className="hidden lg:block">
              <DemoVisual type={step.visual} color={step.color} />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="max-w-5xl mx-auto px-6 pb-12">
        <div className="flex items-center justify-between pt-8 border-t border-slate-800/40">
          <button
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Previous
          </button>

          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-6 py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <Link to="/onboarding" className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-6 py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Demo Visual Illustrations ─────────────────────────────────────────────────
function DemoVisual({ type, color: _color }: { type: string; color: string }) {
  if (type === 'hero' || type === 'cta') {
    return (
      <div className="glass-panel rounded-2xl border border-slate-700/40 p-8 flex flex-col items-center justify-center min-h-[300px] text-center">
        <Compass className="w-16 h-16 text-emerald-400 mb-4 drop-shadow-[0_0_20px_rgba(52,211,153,0.4)]" />
        <p className="text-2xl font-bold text-white mb-2">Free. Instant. Professional.</p>
        <p className="text-slate-500 text-sm max-w-xs">The best engineering tools should be accessible to everyone, everywhere.</p>
      </div>
    );
  }

  if (type === 'cad') {
    return (
      <div className="glass-panel rounded-2xl border border-slate-700/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/60 bg-slate-900/50">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          </div>
          <span className="text-[10px] text-slate-500 font-mono ml-2">CAD Workspace</span>
        </div>
        <div className="flex">
          <div className="w-10 border-r border-slate-800/60 flex flex-col items-center pt-3 gap-2 bg-slate-900/30">
            {[MousePointer, Move, PenTool, Layers, Ruler].map((I, i) => (
              <div key={i} className={`w-7 h-7 rounded flex items-center justify-center ${i === 2 ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-600'}`}>
                <I className="w-3.5 h-3.5" />
              </div>
            ))}
          </div>
          <div className="flex-1 p-4 min-h-[280px] relative">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #475569 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
            <svg className="w-full h-full" viewBox="0 0 300 240">
              {/* Outer walls */}
              <rect x="30" y="20" width="240" height="200" fill="none" stroke="#34d399" strokeWidth="3" />
              {/* Interior wall */}
              <line x1="150" y1="20" x2="150" y2="140" stroke="#34d399" strokeWidth="2" />
              <line x1="150" y1="170" x2="150" y2="220" stroke="#34d399" strokeWidth="2" />
              {/* Door opening */}
              <path d="M 150 140 Q 175 140 175 165" fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="4 2" />
              {/* Windows */}
              <line x1="80" y1="20" x2="120" y2="20" stroke="#60a5fa" strokeWidth="4" />
              <line x1="200" y1="20" x2="240" y2="20" stroke="#60a5fa" strokeWidth="4" />
              {/* Room labels */}
              <text x="70" y="125" fill="#94a3b8" fontSize="11" fontFamily="monospace">Living Room</text>
              <text x="65" y="145" fill="#64748b" fontSize="9" fontFamily="monospace">14' x 12'</text>
              <text x="175" y="85" fill="#94a3b8" fontSize="11" fontFamily="monospace">Bedroom</text>
              <text x="185" y="105" fill="#64748b" fontSize="9" fontFamily="monospace">12' x 10'</text>
              {/* Dimension line */}
              <line x1="30" y1="235" x2="270" y2="235" stroke="#475569" strokeWidth="0.5" />
              <text x="130" y="248" fill="#475569" fontSize="8" fontFamily="monospace">26'-0"</text>
              {/* HVAC unit */}
              <rect x="55" y="185" width="20" height="20" rx="2" fill="#059669" fillOpacity="0.3" stroke="#34d399" strokeWidth="1" />
              <text x="80" y="200" fill="#34d399" fontSize="7" fontFamily="monospace">3-ton</text>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'calc') {
    return (
      <div className="glass-panel rounded-2xl border border-orange-500/20 p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Thermometer className="w-5 h-5 text-orange-400" />
          <span className="text-sm font-bold text-orange-300">Manual J Results</span>
        </div>
        {[
          { room: 'Living Room', cool: '8,450', heat: '6,200', area: '168 sqft' },
          { room: 'Master Bedroom', cool: '5,320', heat: '4,100', area: '144 sqft' },
          { room: 'Kitchen', cool: '6,890', heat: '5,450', area: '120 sqft' },
          { room: 'Bathroom', cool: '2,100', heat: '1,800', area: '48 sqft' },
        ].map((r) => (
          <div key={r.room} className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
            <div>
              <p className="text-sm font-medium text-white">{r.room}</p>
              <p className="text-[10px] text-slate-600">{r.area}</p>
            </div>
            <div className="flex gap-4 text-right">
              <div>
                <p className="text-xs text-sky-400 font-mono font-bold">{r.cool}</p>
                <p className="text-[9px] text-slate-600">BTU/h cool</p>
              </div>
              <div>
                <p className="text-xs text-orange-400 font-mono font-bold">{r.heat}</p>
                <p className="text-[9px] text-slate-600">BTU/h heat</p>
              </div>
            </div>
          </div>
        ))}
        <div className="pt-3 border-t border-slate-700/40 flex justify-between">
          <span className="text-sm font-bold text-white">Total Load</span>
          <div className="flex gap-4">
            <span className="text-sm text-sky-400 font-mono font-bold">22,760 BTU/h</span>
            <span className="text-sm text-orange-400 font-mono font-bold">17,550 BTU/h</span>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 text-center pt-1">Equipment: 2-ton heat pump (SEER2 16.0 / HSPF2 9.5)</p>
      </div>
    );
  }

  if (type === '3d') {
    return (
      <div className="glass-panel rounded-2xl border border-sky-500/20 p-6 flex flex-col items-center justify-center min-h-[300px]">
        <Box className="w-20 h-20 text-sky-400 mb-4" strokeWidth={1} />
        <div className="flex gap-4 mb-6">
          {['Orbit', 'Zoom', 'Pan'].map(label => (
            <div key={label} className="text-center">
              <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-1 mx-auto">
                <Move className="w-4 h-4 text-sky-400" />
              </div>
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-500 text-xs text-center max-w-xs">Interactive 3D viewer with procedural HVAC equipment models, shadow mapping, and export to STL/OBJ formats.</p>
      </div>
    );
  }

  if (type === 'cost') {
    return (
      <div className="glass-panel rounded-2xl border border-amber-500/20 p-6 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-5 h-5 text-amber-400" />
          <span className="text-sm font-bold text-amber-300">Cost Estimate — 2-Ton System</span>
        </div>
        {[
          { item: 'Heat Pump (outdoor unit)', cost: '$3,200' },
          { item: 'Air Handler (indoor unit)', cost: '$1,800' },
          { item: 'Ductwork — attic run', cost: '$2,400' },
          { item: 'Thermostat (smart)', cost: '$250' },
          { item: 'Labor — installation', cost: '$3,500' },
          { item: 'Permits & inspection', cost: '$450' },
        ].map((r) => (
          <div key={r.item} className="flex justify-between py-1.5 border-b border-slate-800/30 last:border-0">
            <span className="text-sm text-slate-400">{r.item}</span>
            <span className="text-sm text-white font-mono">{r.cost}</span>
          </div>
        ))}
        <div className="pt-3 border-t border-amber-500/20 flex justify-between">
          <span className="text-sm font-bold text-white">Estimated Total</span>
          <span className="text-lg text-amber-400 font-mono font-bold">$11,600</span>
        </div>
        <p className="text-[10px] text-slate-600 text-center">Range: $9,800 — $13,400 depending on region</p>
      </div>
    );
  }

  if (type === 'reports') {
    return (
      <div className="glass-panel rounded-2xl border border-violet-500/20 p-6 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-48 bg-white rounded-lg shadow-2xl p-4 mb-4">
          <div className="h-2 w-24 bg-slate-200 rounded mb-2" />
          <div className="h-1.5 w-32 bg-slate-100 rounded mb-3" />
          <div className="h-20 bg-slate-50 rounded border border-slate-200 mb-2 flex items-center justify-center">
            <Building2 className="w-8 h-8 text-slate-300" />
          </div>
          <div className="space-y-1">
            <div className="h-1 w-full bg-slate-100 rounded" />
            <div className="h-1 w-3/4 bg-slate-100 rounded" />
            <div className="h-1 w-5/6 bg-slate-100 rounded" />
          </div>
        </div>
        <p className="text-slate-500 text-xs text-center max-w-xs">Multi-page PDF with floor plans, room schedules, thermal summaries, and cost breakdowns. One-click export.</p>
      </div>
    );
  }

  if (type === 'pwa') {
    return (
      <div className="glass-panel rounded-2xl border border-rose-500/20 p-6 flex flex-col items-center justify-center min-h-[300px]">
        <div className="flex gap-6 mb-6">
          {[
            { label: 'Desktop', w: 'w-20', h: 'h-14' },
            { label: 'Tablet', w: 'w-12', h: 'h-16' },
            { label: 'Phone', w: 'w-8', h: 'h-14' },
          ].map(d => (
            <div key={d.label} className="flex flex-col items-center">
              <div className={`${d.w} ${d.h} rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center mb-2`}>
                <HomeIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-[10px] text-slate-500">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-rose-500/10 border border-rose-500/20 mb-4">
          <Zap className="w-3.5 h-3.5 text-rose-400" />
          <span className="text-xs text-rose-300 font-bold">Works Offline</span>
        </div>
        <p className="text-slate-500 text-xs text-center max-w-xs">Install on any device. Full functionality without internet. Your data stays on your device until you choose to sync.</p>
      </div>
    );
  }

  return null;
}
