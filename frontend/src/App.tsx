import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Home, Compass, Settings, Users, LogOut, Thermometer, PenTool } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CadWorkspace from './pages/CadWorkspace';
import ManualJCalculator from './pages/ManualJCalculator';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import AuthPage from './pages/AuthPage';
import { useAuthStore } from './features/auth/store/useAuthStore';

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

function AppLayout() {
  const { isAuthenticated, organisation, logout } = useAuthStore();
  const location = useLocation();

  // CAD workspace is full-screen — no sidebar
  const isCadRoute = location.pathname.includes('/cad');

  return (
    <div className="flex bg-slate-950 text-slate-100 font-sans h-screen w-screen overflow-hidden">

      {/* Sidebar - Only show if authenticated and not on CAD/landing/onboarding */}
      {isAuthenticated && !isCadRoute && (
        <nav className="w-16 md:w-64 glass-panel border-r border-slate-800/60 flex flex-col justify-between py-6 transition-all duration-300 z-50">
          <div className="px-4">
            <div className="flex items-center gap-3 mb-10 text-emerald-400">
              <Compass className={`w-8 h-8 flex-shrink-0 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)] ${organisation?.type === 'municipality' ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]' : ''}`} />
              <h1 className="text-xl font-bold tracking-tight hidden md:block premium-gradient-text truncate">
                HVAC DesignPro
              </h1>
            </div>

            <div className="flex flex-col gap-2">
              <NavigationLink to="/dashboard" icon={<Home className="w-5 h-5" />} label="Projects" />
              <NavigationLink to="/calculator" icon={<Thermometer className="w-5 h-5" />} label="Manual J Calc" />
              <NavigationLink to="/cad" icon={<PenTool className="w-5 h-5" />} label="CAD Workspace" />

              <div className="h-px bg-slate-800/60 my-3" />

              <NavigationLink to="/team" icon={<Users className="w-5 h-5" />} label="Team" />
              <NavigationLink to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" />
            </div>
          </div>

          <div className="px-4">
             <button
              onClick={logout}
              className="flex w-full items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors group"
             >
                <LogOut className="w-5 h-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
                <span className="font-medium hidden md:block">Sign Out</span>
              </button>
          </div>
        </nav>
      )}

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black">
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={!isAuthenticated ? <LandingPage /> : <Navigate to="/dashboard" />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/login" element={<AuthPage />} />

          {/* Protected Routes */}
          <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="/calculator" element={isAuthenticated ? <ManualJCalculator /> : <Navigate to="/login" />} />
          <Route path="/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/login" />} />
          <Route path="/project/:id/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/login" />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function NavigationLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const { organisation } = useAuthStore();
  const isMuni = organisation?.type === 'municipality';
  const active = location.pathname === to;

  const activeClass = isMuni
    ? "bg-slate-800/50 text-amber-300 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
    : "bg-slate-800/50 text-emerald-300 border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.1)]";

  return (
    <Link to={to} className={`flex items-center gap-3 p-3 rounded-xl transition-all border border-transparent hover:bg-slate-800/50 ${active ? activeClass : 'text-slate-400 hover:text-slate-100'}`}>
      <div className="flex-shrink-0">{icon}</div>
      <span className="font-medium hidden md:block">{label}</span>
    </Link>
  );
}

export default App;
