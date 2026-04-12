import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Home, Compass, Settings, Users, LogOut, Thermometer, PenTool, Menu, X, Search, BookOpen } from 'lucide-react';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import AuthPage from './pages/AuthPage';
import TermsPage from './pages/TermsPage';
import DemoPage from './pages/DemoPage';
import UserAvatarMenu from './components/UserAvatarMenu';

// Lazy-load heavy pages (Three.js, jsPDF, Fabric.js stay out of initial bundle)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CadWorkspace = lazy(() => import('./pages/CadWorkspace'));
const ManualJCalculator = lazy(() => import('./pages/ManualJCalculator'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const UserGuidePage = lazy(() => import('./pages/UserGuidePage'));
import { useAuthStore } from './features/auth/store/useAuthStore';
import { usePreferencesStore } from './stores/usePreferencesStore';
import SpotlightSearch, { SpotlightTrigger } from './features/spotlight/SpotlightSearch';
import SkipLinks from './components/accessibility/SkipLinks';
import A11yProvider from './components/accessibility/A11yProvider';

function App() {
  return (
    <A11yProvider>
      <BrowserRouter>
        <SkipLinks />
        <AppLayout />
      </BrowserRouter>
    </A11yProvider>
  );
}

function AppLayout() {
  const { isAuthenticated, organisation, logout, restoreSession } = useAuthStore();

  // Validate persisted session on mount
  useEffect(() => { restoreSession(); }, [restoreSession]);
  const { sidebarCollapsed, update: updatePrefs } = usePreferencesStore();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // CAD workspace is full-screen — no sidebar
  const isCadRoute = location.pathname.includes('/cad');
  const showSidebar = isAuthenticated && !isCadRoute;

  // Public pages that need full-page scroll (not locked in app shell)
  const isPublicScrollPage = ['/', '/terms', '/login', '/onboarding', '/landing', '/demo'].includes(location.pathname);

  return (
    <div className="flex flex-col md:flex-row bg-slate-950 text-slate-100 font-sans min-h-screen md:h-screen md:overflow-hidden">

      {/* ── Mobile Top Bar ── */}
      {showSidebar && (
        <div className="md:hidden flex items-center justify-between px-4 py-3 glass-panel border-b border-slate-800/60 z-50 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Compass className={`w-6 h-6 flex-shrink-0 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)] ${organisation?.type === 'municipality' ? 'text-amber-400' : 'text-emerald-400'}`} />
            <span className="text-sm font-bold premium-gradient-text">DesignPro</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="p-2.5 rounded-xl hover:bg-slate-800/50 text-slate-400 hover:text-emerald-400 min-w-[44px] min-h-[44px] flex items-center justify-center">
              <Search className="w-5 h-5" />
            </button>
            <UserAvatarMenu size={32} compact />
            <button onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="p-2.5 rounded-xl hover:bg-slate-800/50 text-slate-400 min-w-[44px] min-h-[44px] flex items-center justify-center">
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile Nav Drawer ── */}
      {showSidebar && mobileNavOpen && (
        <div className="md:hidden fixed inset-0 top-[57px] z-40">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <nav className="relative glass-panel border-b border-slate-800/60 p-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
            <MobileNavLink to="/dashboard" icon={<Home className="w-5 h-5" />} label="Projects" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/calculator" icon={<Thermometer className="w-5 h-5" />} label="Manual J" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/cad" icon={<PenTool className="w-5 h-5" />} label="CAD" onClick={() => setMobileNavOpen(false)} />
            <div className="h-px bg-slate-800/60 my-2" />
            <MobileNavLink to="/team" icon={<Users className="w-5 h-5" />} label="Team" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/guide" icon={<BookOpen className="w-5 h-5" />} label="Guide" onClick={() => setMobileNavOpen(false)} />
            <div className="h-px bg-slate-800/60 my-2" />
            <button onClick={() => { logout(); setMobileNavOpen(false); }}
              className="flex w-full items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors min-h-[44px]">
              <LogOut className="w-5 h-5" />
              <span className="font-medium text-sm">Sign Out</span>
            </button>
          </nav>
        </div>
      )}

      {/* ── Desktop Sidebar ── */}
      {showSidebar && (
        <nav aria-label="Main navigation" className={`hidden md:flex ${sidebarCollapsed ? 'w-16' : 'w-56'} glass-panel border-r border-slate-800/60 flex-col justify-between py-4 transition-all duration-300 z-50 flex-shrink-0`}>
          <div className="px-2.5">
            <button
              onClick={() => updatePrefs({ sidebarCollapsed: !sidebarCollapsed })}
              className="flex items-center gap-2.5 mb-8 px-1.5 py-1 text-emerald-400 w-full hover:opacity-80 transition-opacity"
            >
              <Compass className={`w-7 h-7 flex-shrink-0 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)] ${organisation?.type === 'municipality' ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]' : ''}`} />
              {!sidebarCollapsed && (
                <h1 className="text-base font-bold tracking-tight premium-gradient-text truncate">
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
              <NavigationLink to="/guide" icon={<BookOpen className="w-5 h-5" />} label="Guide" collapsed={sidebarCollapsed} />
            </div>
          </div>

          <div className="px-2.5 space-y-1">
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className={`flex w-full items-center gap-2.5 p-3 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors group min-h-[44px] ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? 'Search (Ctrl+K)' : undefined}
            >
              <Search className="w-5 h-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              {!sidebarCollapsed && (
                <span className="font-medium text-sm flex-1">Search</span>
              )}
              {!sidebarCollapsed && (
                <kbd className="text-[10px] text-slate-600 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-mono">
                  ⌘K
                </kbd>
              )}
            </button>
            <div className={`flex ${sidebarCollapsed ? 'justify-center' : 'px-1.5'} py-1`}>
              <UserAvatarMenu
                size={sidebarCollapsed ? 34 : 32}
                showName={!sidebarCollapsed}
                compact={sidebarCollapsed}
                dropUp
                align="left"
              />
            </div>
          </div>
        </nav>
      )}

      {/* Spotlight Search — Global Cmd+K */}
      {isAuthenticated && <SpotlightSearch />}
      {isAuthenticated && !isCadRoute && <SpotlightTrigger />}

      {/* Main Content Area */}
      <main id="main-content" role="main" className={`flex-1 relative overflow-y-auto ${isPublicScrollPage ? '' : 'md:overflow-hidden'} bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black`}>
        <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /></div>}>
        <Routes>
          {/* Public routes — authentication required to proceed past sign-in */}
          <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" /> : <AuthPage />} />
          <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <AuthPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* App Routes — redirect to sign-in if not authenticated */}
          <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/" />} />
          <Route path="/calculator" element={isAuthenticated ? <ManualJCalculator /> : <Navigate to="/" />} />
          <Route path="/settings" element={isAuthenticated ? <SettingsPage /> : <Navigate to="/" />} />
          <Route path="/guide" element={isAuthenticated ? <UserGuidePage /> : <Navigate to="/" />} />
          <Route path="/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/" />} />
          <Route path="/project/:id/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/" />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function MobileNavLink({ to, icon, label, onClick }: { to: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  const location = useLocation();
  const { organisation } = useAuthStore();
  const isMuni = organisation?.type === 'municipality';
  const active = location.pathname === to;

  const activeClass = isMuni
    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
    : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";

  return (
    <Link to={to} onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all border border-transparent min-h-[44px] ${active ? activeClass : 'text-slate-300 hover:bg-slate-800/50'}`}>
      <div className="flex-shrink-0">{icon}</div>
      <span className="font-medium text-sm">{label}</span>
    </Link>
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
    <Link to={to} className={`flex items-center gap-2.5 p-3 rounded-xl transition-all border border-transparent hover:bg-slate-800/50 min-h-[44px] ${active ? activeClass : 'text-slate-400 hover:text-slate-100'} ${collapsed ? 'justify-center' : ''}`} title={collapsed ? label : undefined}>
      <div className="flex-shrink-0">{icon}</div>
      {!collapsed && <span className="font-medium text-sm">{label}</span>}
    </Link>
  );
}

export default App;
