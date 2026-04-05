import { Link } from 'react-router-dom';
import { Compass, ArrowRight, Zap, Shield, Building2, Globe } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-200 overflow-x-hidden">
      
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
             <Compass className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
          </div>
          <span className="text-xl font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
        </div>
        <div className="flex items-center gap-8">
          <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Sign In</Link>
          <Link 
            to="/onboarding" 
            className="bg-slate-100 text-slate-950 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all transform hover:-translate-y-0.5"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 max-w-7xl mx-auto px-8 pt-20 pb-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Zap className="w-3.5 h-3.5 fill-current" />
            Empowering the HVAC Future
          </div>
          <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight mb-8 leading-[1.1] animate-in fade-in slide-in-from-bottom-6 duration-1000">
            Next Generation <br />
            <span className="text-slate-500">Design & Management</span>
          </h1>
          <p className="text-xl text-slate-400 leading-relaxed max-w-2xl mb-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            An all-in-one suite for contractors, engineering firms, and municipalities. 
            Automated ACCA Manual J/D/S compliance with a SpaceX-inspired CAD interface.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000">
            <Link 
              to="/onboarding" 
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 px-8 py-4 rounded-full text-lg font-bold hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1"
            >
              Start Your First Project <ArrowRight className="w-5 h-5" />
            </Link>
            <button className="w-full sm:w-auto text-slate-400 hover:text-white px-8 py-4 font-bold transition-colors">
              Schedule a Demo
            </button>
          </div>
        </div>
      </main>

      {/* Role Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 grid grid-cols-1 md:grid-cols-3 gap-8 pb-32">
        <RoleCard 
          icon={<Building2 className="w-6 h-6" />}
          title="Companies"
          description="Scale your workforce with centralized multi-tenant management and collaborative floorplans."
          color="emerald"
        />
        <RoleCard 
          icon={<Globe className="w-6 h-6" />}
          title="Municipalities"
          description="Streamline permit approvals with standardized digital submittals and automated code checks."
          color="amber"
        />
        <RoleCard 
          icon={<Shield className="w-6 h-6" />}
          title="Individuals"
          description="All the power of enterprise CAD in a lightweight, pay-as-you-go toolkit for contractors."
          color="sky"
        />
      </section>
    </div>
  );
}

function RoleCard({ icon, title, description, color }: { icon: React.ReactNode, title: string, description: string, color: 'emerald' | 'amber' | 'sky' }) {
  const themes = {
    emerald: 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5 hover:border-emerald-500/40',
    amber: 'border-amber-500/20 text-amber-400 bg-amber-500/5 hover:border-amber-500/40',
    sky: 'border-sky-500/20 text-sky-400 bg-sky-500/5 hover:border-sky-500/40',
  };

  return (
    <div className={`glass-panel p-8 rounded-3xl border transition-all duration-300 group hover:-translate-y-2 ${themes[color]}`}>
      <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-900 border border-slate-700/50 mb-6 group-hover:scale-110 transition-transform shadow-xl">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{title}</h3>
      <p className="text-slate-400 leading-relaxed text-sm">
        {description}
      </p>
    </div>
  );
}
