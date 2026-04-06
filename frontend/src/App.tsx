import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Home, Compass, Settings, Users, LogOut, Thermometer, PenTool } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import CadWorkspace from './pages/CadWorkspace';
import ManualJCalculator from './pages/ManualJCalculator';
import SettingsPage from './pages/SettingsPage';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import AuthPage from './pages/AuthPage';
import TermsPage from './pages/TermsPage';
import { useAuthStore } from './features/auth/store/useAuthStore';
import { usePreferencesStore } from './stores/usePreferencesStore';

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

function AppLayout() {
  const { isAuthenticated, organisation, logout } = useAuthStore();
  const { sidebarCollapsed, update: updatePrefs } = usePreferencesStore();
  const location = useLocation();

  // CAD workspace is full-screen — no sidebar
  const isCadRoute = location.pathname.includes('/cad');

  return (
    <div className="flex bg-slate-950 text-slate-100 font-sans h-screen w-screen overflow-hidden">

      {/* Sidebar - Only show if authenticated and not on CAD/landing/onboarding */}
      {isAuthenticated && !isCadRoute && (
        <nav className={`${sidebarCollapsed ? 'w-16' : 'w-16 md:w-56'} glass-panel border-r border-slate-800/60 flex flex-col justify-between py-4 transition-all duration-300 z-50 flex-shrink-0`}>
          <div className="px-2.5">
            <button
              onClick={() => updatePrefs({ sidebarCollapsed: !sidebarCollapsed })}
              className="flex items-center gap-2.5 mb-8 px-1.5 py-1 text-emerald-400 w-full hover:opacity-80 transition-opacity"
            >
              <Compass className={`w-7 h-7 flex-shrink-0 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)] ${organisation?.type === 'municipality' ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]' : ''}`} />
              {!sidebarCollapsed && (
                <h1 className="text-base font-bold tracking-tight hidden md:block premium-gradient-text truncate">
                  DesignPro
                </h1>
              )}
            </button>

            <div className="flex flex-col gap-1">
              <NavigationLink to="/dashboard" icon={<Home className="w-5 h-5" />} label="Projects" collapsed={sidebarCollapsed} />
              <NavigationLink to="/calculator" icon={<Thermometer className="w-5 h-5" />} label="Manual J" collapsed={sidebarCollapsed} />
              <NavigationLink to="/cad" icon={<PenTool className="w-5 h-5" />} label="CAD" collapsed={sidebarCollapsed} />

              <div className="h-px bg-slate-800/60 my-2" />

              <NavigationLink to="/team" icon={<Users className="w-5 h-5" />} label="Team" collapsed={sidebarCollapsed} />
              <NavigationLink to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" collapsed={sidebarCollapsed} />
            </div>
          </div>

          <div className="px-2.5">
             <button
              onClick={logout}
              className="flex w-full items-center gap-2.5 p-2.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors group"
             >
                <LogOut className="w-5 h-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
                {!sidebarCollapsed && <span className="font-medium text-sm hidden md:block">Sign Out</span>}
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
          <Route path="/terms" element={<TermsPage />} />

          {/* Protected Routes */}
          <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="/calculator" element={isAuthenticated ? <ManualJCalculator /> : <Navigate to="/login" />} />
          <Route path="/settings" element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" />} />
          <Route path="/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/login" />} />
          <Route path="/project/:id/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/login" />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function NavigationLink({ to, icon, label, collapsed = false }: { to: string; icon: React.ReactNode; label: string; collapsed?: boolean }) {
  const location = useLocation();
  const { organisation } = useAuthStore();
  const isMuni = organisation?.type === 'municipality';
  const active = location.pathname === to;

  const activeClass = isMuni
    ? "bg-slate-800/50 text-amber-300 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.1)]"
    : "bg-slate-800/50 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(52,211,153,0.1)]";

  return (
    <Link to={to} className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-all border border-transparent hover:bg-slate-800/50 ${active ? activeClass : 'text-slate-400 hover:text-slate-100'} ${collapsed ? 'justify-center' : ''}`} title={collapsed ? label : undefined}>
      <div className="flex-shrink-0">{icon}</div>
      {!collapsed && <span className="font-medium text-sm hidden md:block">{label}</span>}
    </Link>
  );
}

export default App;
