import { Link } from 'react-router-dom';
import {
  Compass, ArrowRight, Zap, Shield, Building2, Globe,
  PenTool, FileText, Wifi, WifiOff, Smartphone,
  LayoutGrid, Calculator, Layers
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-200 scroll-smooth">

      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] right-[-5%] w-[40%] h-[40%] rounded-full bg-emerald-500/8 blur-[100px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[35%] h-[35%] rounded-full bg-sky-500/8 blur-[100px]" />
      </div>

      {/* ── Sticky Nav ────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/40">
        <div className="flex items-center justify-between px-6 py-3 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <Compass className="w-7 h-7 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
            <span className="text-lg font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition-colors px-4 py-2">Sign In</Link>
            <Link
              to="/onboarding"
              className="bg-emerald-500 text-slate-950 px-5 py-2 rounded-full text-sm font-bold hover:bg-emerald-400 transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-6">
              <Zap className="w-3 h-3 fill-current" />
              PWA — Install & Work Offline
            </div>
            <h1 className="text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 leading-[1.08]">
              Design HVAC<br />
              <span className="premium-gradient-text">Systems Faster</span>
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed max-w-lg mb-8">
              Manual J load calculations, CAD floor plans, and equipment sizing
              in one offline-capable workspace. ACCA compliant. Zero setup.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/onboarding"
                className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-7 py-3.5 rounded-full font-bold hover:bg-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] transition-all"
              >
                Start Free <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/login"
                className="px-7 py-3.5 rounded-full font-bold text-slate-300 border border-slate-700 hover:border-slate-500 hover:text-white transition-all"
              >
                Sign In
              </Link>
            </div>
          </div>

          {/* Hero Visual — Mini app preview */}
          <div className="hidden lg:block">
            <div className="glass-panel rounded-2xl border border-slate-700/40 p-1 shadow-2xl">
              <div className="bg-slate-900 rounded-xl overflow-hidden">
                {/* Fake title bar */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/60">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono ml-2">hvac-design-pro.pages.dev</span>
                </div>
                {/* Fake workspace */}
                <div className="flex h-56">
                  <div className="w-12 border-r border-slate-800/60 flex flex-col items-center pt-3 gap-2.5">
                    {[PenTool, LayoutGrid, Layers].map((Icon, i) => (
                      <div key={i} className={`w-7 h-7 rounded-lg flex items-center justify-center ${i === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-600'}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 relative">
                    {/* Grid dots */}
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle, #475569 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                    {/* Fake walls */}
                    <svg className="absolute inset-0 w-full h-full">
                      <line x1="60" y1="40" x2="280" y2="40" stroke="#34d399" strokeWidth="3" />
                      <line x1="280" y1="40" x2="280" y2="180" stroke="#34d399" strokeWidth="3" />
                      <line x1="280" y1="180" x2="60" y2="180" stroke="#34d399" strokeWidth="3" />
                      <line x1="60" y1="180" x2="60" y2="40" stroke="#34d399" strokeWidth="3" />
                      <line x1="170" y1="40" x2="170" y2="180" stroke="#34d399" strokeWidth="2" strokeDasharray="6 4" opacity="0.5" />
                      <text x="100" y="116" fill="#94a3b8" fontSize="10" fontFamily="monospace">12' x 10'</text>
                      <text x="200" y="116" fill="#94a3b8" fontSize="10" fontFamily="monospace">9' x 10'</text>
                    </svg>
                  </div>
                  <div className="w-40 border-l border-slate-800/60 p-3">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Properties</p>
                    <div className="space-y-2">
                      {[['R-Value', '19'], ['Height', '9 ft'], ['Material', 'Stud']].map(([k, v]) => (
                        <div key={k}>
                          <p className="text-[8px] text-slate-600 uppercase">{k}</p>
                          <p className="text-[10px] text-slate-300 font-mono">{v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ─────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-white mb-2">Everything You Need</h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto">Professional-grade tools that work anywhere — desktop, tablet, or phone.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={<Calculator className="w-5 h-5" />}
            title="Manual J Calculator"
            description="Room-by-room heating & cooling load calculations with ACCA compliance."
            color="orange"
          />
          <FeatureCard
            icon={<PenTool className="w-5 h-5" />}
            title="CAD Workspace"
            description="Draw walls, place doors/windows, and design duct layouts on an infinite canvas."
            color="emerald"
          />
          <FeatureCard
            icon={<FileText className="w-5 h-5" />}
            title="PDF Reports"
            description="Export professional title-block reports for permits and client deliverables."
            color="sky"
          />
          <FeatureCard
            icon={<WifiOff className="w-5 h-5" />}
            title="Offline First"
            description="Full PWA — install on any device, work without internet, sync when connected."
            color="violet"
          />
          <FeatureCard
            icon={<Smartphone className="w-5 h-5" />}
            title="Any Device"
            description="Responsive across desktop, tablet, and mobile. Touch-optimized CAD tools."
            color="amber"
          />
          <FeatureCard
            icon={<Wifi className="w-5 h-5" />}
            title="Real-Time Sync"
            description="Collaborative editing with team members. Changes sync instantly."
            color="rose"
          />
        </div>
      </section>

      {/* ── Role Cards ────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RoleCard
            icon={<Building2 className="w-5 h-5" />}
            title="Companies"
            description="Multi-tenant management, team collaboration, centralized project library."
            color="emerald"
          />
          <RoleCard
            icon={<Globe className="w-5 h-5" />}
            title="Municipalities"
            description="Standardized digital submittals, automated code checks, permit tracking."
            color="amber"
          />
          <RoleCard
            icon={<Shield className="w-5 h-5" />}
            title="Individuals"
            description="Enterprise CAD power in a lightweight, pay-as-you-go toolkit."
            color="sky"
          />
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
        <div className="glass-panel rounded-2xl border border-emerald-500/20 p-10 text-center bg-gradient-to-br from-slate-900/80 to-emerald-950/30">
          <h2 className="text-3xl font-bold text-white mb-3">Ready to modernize your workflow?</h2>
          <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            Join engineers and contractors already using DesignPro for faster, compliant HVAC design.
          </p>
          <Link
            to="/onboarding"
            className="inline-flex items-center gap-2 bg-emerald-500 text-slate-950 px-8 py-4 rounded-full text-lg font-bold hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all"
          >
            Get Started Free <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-slate-800/40 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-slate-600">
          <span>&copy; {new Date().getFullYear()} C4 Technologies — HVAC DesignPro</span>
          <div className="flex gap-6">
            <Link to="/terms" className="hover:text-slate-400 transition-colors">Terms of Service</Link>
            <span>ACCA Manual J/D/S</span>
            <span>ASHRAE Compliant</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: string }) {
  const iconColors: Record<string, string> = {
    orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

  return (
    <div className="glass-panel rounded-xl border border-slate-800/40 p-5 hover:border-slate-700/60 transition-all group">
      <div className={`inline-flex p-2 rounded-lg border mb-3 ${iconColors[color]}`}>
        {icon}
      </div>
      <h3 className="text-sm font-bold text-white mb-1 group-hover:text-emerald-300 transition-colors">{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

function RoleCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: 'emerald' | 'amber' | 'sky' }) {
  const themes = {
    emerald: 'border-emerald-500/20 hover:border-emerald-500/40',
    amber: 'border-amber-500/20 hover:border-amber-500/40',
    sky: 'border-sky-500/20 hover:border-sky-500/40',
  };
  const iconThemes = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    sky: 'text-sky-400 bg-sky-500/10',
  };

  return (
    <div className={`glass-panel p-6 rounded-xl border transition-all duration-300 hover:-translate-y-1 ${themes[color]}`}>
      <div className={`w-10 h-10 flex items-center justify-center rounded-xl mb-4 ${iconThemes[color]}`}>
        {icon}
      </div>
      <h3 className="text-base font-bold text-white mb-2">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}
