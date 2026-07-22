import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Home, Settings, Users, LogOut, Thermometer, PenTool, Menu, X, Search, BookOpen, GitBranch, Sun, Globe, ShieldCheck, Activity, PackageCheck, FileText } from 'lucide-react';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import AuthPage from './pages/AuthPage';
import TermsPage from './pages/TermsPage';
import DemoPage from './pages/DemoPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
// MFA pages run PRE-SESSION (no bearer yet), so they belong in the public
// route group alongside verify-email / forgot-password. Lazy-loaded.
const MfaChallengePage = lazy(() => import('./pages/MfaChallengePage'));
const MfaEnrollPage = lazy(() => import('./pages/MfaEnrollPage'));
import UserAvatarMenu from './components/UserAvatarMenu';
import hvacEmblem from './assets/brand/hvac-emblem.png';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/ToastContainer';
import ImpersonationBanner from './components/ImpersonationBanner';
import TransferRequestNotice from './components/TransferRequestNotice';

// Lazy-load heavy pages (Three.js, jsPDF, Fabric.js stay out of initial bundle)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CadWorkspace = lazy(() => import('./pages/CadWorkspace'));
const ManualJCalculator = lazy(() => import('./pages/ManualJCalculator'));
const ManualDCalculator = lazy(() => import('./pages/ManualDCalculator'));
const AedAnalysis = lazy(() => import('./pages/AedAnalysis'));
const ManualSCalculator = lazy(() => import('./pages/ManualSCalculator'));
const CombinedReportPage = lazy(() => import('./pages/CombinedReportPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const UserGuidePage = lazy(() => import('./pages/UserGuidePage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const CommunityPage = lazy(() => import('./pages/CommunityPage'));
const PermitsPage = lazy(() => import('./pages/PermitsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
import { useAuthStore } from './features/auth/store/useAuthStore';
import { usePreferencesStore } from './stores/usePreferencesStore';
import { useAccessPolicyStore } from './stores/useAccessPolicyStore';
import { notify, useNotificationStore } from './stores/useNotificationStore';
import NotificationCenter from './components/NotificationCenter';
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
      <ToastContainer />
    </A11yProvider>
  );
}

function AppLayout() {
  const { isAuthenticated, organisation, logout, restoreSession } = useAuthStore();

  // Validate persisted session on mount
  useEffect(() => { restoreSession(); }, [restoreSession]);

  // Load the tenant's access-policy capabilities once authenticated so
  // the UI can hide surfaces the caller's role can't use. Reset on
  // logout so the next session doesn't inherit stale capabilities.
  const refreshAccessPolicy = useAccessPolicyStore((s) => s.refresh);
  const resetAccessPolicy = useAccessPolicyStore((s) => s.reset);
  useEffect(() => {
    if (isAuthenticated) {
      void refreshAccessPolicy();
      // Pull the org's notification policy so client-side delivery resolution
      // reflects what the tenant admin has forced on/off. (The store also
      // refetches on a user-id change; this covers the already-signed-in boot.)
      void useNotificationStore.getState().refreshOrgPolicy();
    } else {
      resetAccessPolicy();
    }
  }, [isAuthenticated, refreshAccessPolicy, resetAccessPolicy]);

  // ── Live capability reconciliation (Phase 1) ──────────────────────────
  // The server enforces role/status fresh on every request, so there is
  // no security gap here — this is purely so the UI adapts in place when
  // an admin (or L0) rotates someone's rank mid-session, instead of the
  // moved user seeing stale chrome until they happen to reload.
  //
  // Mechanism already exists: restoreSession() re-pulls /api/auth/me and
  // overwrites `user`; useAccessPolicyStore.refresh() re-pulls
  // capabilities. We just trigger them on a heartbeat + on tab-focus,
  // diff the result, and surface a non-disruptive toast on a real delta.
  // No forced logout. Failure-safe: restoreSession keeps the session on
  // network error (offline-PWA) and only clears on a real 401 (which is
  // exactly the correct UX for a just-deactivated user — they fall out
  // cleanly within a heartbeat); refresh() keeps last-good capabilities
  // on a failed poll. A `reconciling` ref coalesces focus+interval so we
  // never overlap.
  const reconcilingRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) return;

    const snapshot = () => {
      const role = useAuthStore.getState().user?.role ?? null;
      const c = useAccessPolicyStore.getState().capabilities;
      return `${role}|${c.canViewAudit}|${c.canRestoreVersions}|${c.canViewVersions}|${c.canEditPolicy}`;
    };

    const reconcile = async () => {
      if (reconcilingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      reconcilingRef.current = true;
      const before = snapshot();
      try {
        await restoreSession();
        // If restoreSession cleared the session (real 401 / deactivated),
        // bail — the deauth path handles UX; don't toast "access changed".
        if (!useAuthStore.getState().isAuthenticated) return;
        await refreshAccessPolicy();
        const after = snapshot();
        if (after !== before) {
          // Durable + transient: records a security notification (bell) AND
          // flashes the same message as a toast for immediacy.
          notify.security('Your access level was updated — the workspace has adjusted to your current role.', {
            severity: 'info',
          });
        }
      } catch {
        /* failure-safe: stores keep last-good state; try again next tick */
      } finally {
        reconcilingRef.current = false;
      }
    };

    const HEARTBEAT_MS = 60_000;
    const interval = setInterval(() => { void reconcile(); }, HEARTBEAT_MS);
    const onFocus = () => { void reconcile(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [isAuthenticated, restoreSession, refreshAccessPolicy]);

  const { sidebarCollapsed, update: updatePrefs } = usePreferencesStore();
  const canViewAudit = useAccessPolicyStore((s) => s.capabilities.canViewAudit);
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Thermal surge — bloom the brand mark's ambient gradient while the sidebar
  // collapses/expands, then let it cool back to its idle drift.
  const [thermalSurge, setThermalSurge] = useState(false);
  const surgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBrandToggle = () => {
    updatePrefs({ sidebarCollapsed: !sidebarCollapsed });
    setThermalSurge(true);
    if (surgeTimer.current) clearTimeout(surgeTimer.current);
    surgeTimer.current = setTimeout(() => setThermalSurge(false), 1400);
  };

  // CAD workspace is full-screen — no sidebar
  const isCadRoute = location.pathname.includes('/cad');
  const showSidebar = isAuthenticated && !isCadRoute;

  // Public pages that need full-page scroll (not locked in app shell)
  const isPublicScrollPage = ['/', '/terms', '/login', '/onboarding', '/landing', '/demo', '/verify-email', '/forgot-password', '/auth/callback', '/auth/mfa-challenge', '/auth/mfa-enroll'].includes(location.pathname);

  return (
    <div className="flex flex-col md:flex-row bg-slate-950 text-slate-100 font-sans min-h-screen md:h-screen md:overflow-hidden">

      {/* ── Mobile Top Bar ── */}
      {showSidebar && (
        <div className="md:hidden flex items-center justify-between px-4 py-3 glass-panel border-b border-slate-800/60 z-50 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <img
              src={hvacEmblem}
              alt="HVAC Design Pro"
              className={`w-7 h-7 flex-shrink-0 rounded-full object-cover ${organisation?.type === 'municipality' ? 'drop-shadow-[0_0_10px_rgba(245,158,11,0.45)]' : 'drop-shadow-[0_0_10px_rgba(52,211,153,0.35)]'}`}
            />
            <span className="text-sm font-bold premium-gradient-text">HVAC Design Pro</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationCenter variant="compact" align="right" />
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
            <MobileNavLink to="/manual-d" icon={<GitBranch className="w-5 h-5" />} label="Manual D" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/aed" icon={<Sun className="w-5 h-5" />} label="AED" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/manual-s" icon={<PackageCheck className="w-5 h-5" />} label="Manual S" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/reports" icon={<FileText className="w-5 h-5" />} label="Reports" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/cad" icon={<PenTool className="w-5 h-5" />} label="CAD" onClick={() => setMobileNavOpen(false)} />
            <div className="h-px bg-slate-800/60 my-2" />
            <MobileNavLink to="/team" icon={<Users className="w-5 h-5" />} label="Team" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/community" icon={<Globe className="w-5 h-5" />} label="Community" onClick={() => setMobileNavOpen(false)} />
            <MobileNavLink to="/permits" icon={<ShieldCheck className="w-5 h-5" />} label="Permits" onClick={() => setMobileNavOpen(false)} />
            {canViewAudit && <MobileNavLink to="/audit-log" icon={<Activity className="w-5 h-5" />} label="Audit log" onClick={() => setMobileNavOpen(false)} />}
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
              onClick={handleBrandToggle}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label="HVAC Design Pro — toggle sidebar"
              className={`relative overflow-hidden rounded-xl flex items-center mb-8 text-emerald-400 hover:opacity-90 transition-opacity ${sidebarCollapsed ? 'w-11 h-11 justify-center left-1/2 -translate-x-1/2' : 'w-full gap-2 px-1 py-1.5'} ${thermalSurge ? 'thermal-surge' : ''}`}
            >
              {/* Machined-metal bezel — rim layers show only at the 1.5px ring
                  left uncovered by the inset core below */}
              <span aria-hidden className="metallic-rim absolute inset-0" />
              <span aria-hidden className="metallic-glint absolute inset-0" />
              <span aria-hidden className="absolute inset-[1.5px] rounded-[10px] bg-slate-950/95" />
              {/* Thermostat ambience — cold→hot drift + breeze sheen */}
              <span aria-hidden className="thermal-ambient absolute inset-[1.5px] rounded-[10px]" />
              <span aria-hidden className="thermal-breeze absolute inset-[1.5px] rounded-[10px]" />
              {/* Gear-vortex emblem — shown in totality when collapsed */}
              <img
                src={hvacEmblem}
                alt=""
                aria-hidden
                className={`relative z-10 shrink-0 max-w-none rounded-full object-cover transition-all duration-300 ${sidebarCollapsed ? 'w-10 h-10' : 'w-8 h-8'} ${organisation?.type === 'municipality' ? 'drop-shadow-[0_0_10px_rgba(245,158,11,0.45)]' : 'drop-shadow-[0_0_10px_rgba(52,211,153,0.35)]'}`}
              />
              {!sidebarCollapsed && (
                <span className="relative z-10 flex flex-col min-w-0 text-left">
                  <h1 className="text-sm font-bold tracking-tight premium-gradient-text truncate leading-tight">
                    HVAC Design Pro
                  </h1>
                  <span className="text-[7px] font-semibold uppercase tracking-[0.05em] text-slate-400 truncate">
                    Legacy Archive &amp; Engineering
                  </span>
                </span>
              )}
            </button>

            <div className="flex flex-col gap-1">
              <NavigationLink to="/dashboard" icon={<Home className="w-5 h-5" />} label="Projects" collapsed={sidebarCollapsed} />
              <NavigationLink to="/calculator" icon={<Thermometer className="w-5 h-5" />} label="Manual J" collapsed={sidebarCollapsed} />
              <NavigationLink to="/manual-d" icon={<GitBranch className="w-5 h-5" />} label="Manual D" collapsed={sidebarCollapsed} />
              <NavigationLink to="/aed" icon={<Sun className="w-5 h-5" />} label="AED" collapsed={sidebarCollapsed} />
              <NavigationLink to="/manual-s" icon={<PackageCheck className="w-5 h-5" />} label="Manual S" collapsed={sidebarCollapsed} />
              <NavigationLink to="/reports" icon={<FileText className="w-5 h-5" />} label="Reports" collapsed={sidebarCollapsed} />
              <NavigationLink to="/cad" icon={<PenTool className="w-5 h-5" />} label="CAD" collapsed={sidebarCollapsed} />

              <div className="h-px bg-slate-800/60 my-2" />

              <NavigationLink to="/team" icon={<Users className="w-5 h-5" />} label="Team" collapsed={sidebarCollapsed} />
              <NavigationLink to="/community" icon={<Globe className="w-5 h-5" />} label="Community" collapsed={sidebarCollapsed} />
              <NavigationLink to="/permits" icon={<ShieldCheck className="w-5 h-5" />} label="Permits" collapsed={sidebarCollapsed} />
              {canViewAudit && <NavigationLink to="/audit-log" icon={<Activity className="w-5 h-5" />} label="Audit log" collapsed={sidebarCollapsed} />}
              <NavigationLink to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" collapsed={sidebarCollapsed} />
              <NavigationLink to="/guide" icon={<BookOpen className="w-5 h-5" />} label="Guide" collapsed={sidebarCollapsed} />
            </div>
          </div>

          <div className="px-2.5 space-y-1">
            <NotificationCenter variant="sidebar" collapsed={sidebarCollapsed} dropUp align="left" />
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

      {/* Global notices — L0 impersonation state + pending account-transfer
          (reparent) consent. Both fixed-position; mutually exclusive in
          practice (impersonating admins don't receive transfer requests). */}
      <ImpersonationBanner />
      <TransferRequestNotice />

      {/* Main Content Area */}
      <main id="main-content" role="main" className={`flex-1 relative overflow-y-auto ${isPublicScrollPage ? '' : 'md:overflow-hidden'} bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black`}>
        <ErrorBoundary label="Application" fullPage key={location.pathname}>
        <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /></div>}>
        <Routes>
          {/* Public routes — authentication required to proceed past sign-in */}
          <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" /> : <AuthPage />} />
          <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <AuthPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          {/* MFA — pre-session second-factor completion + forced enrollment.
              The pages self-guard (redirect to / when no live challenge token
              is in the store), so no isAuthenticated gate here. */}
          <Route path="/auth/mfa-challenge" element={<MfaChallengePage />} />
          <Route path="/auth/mfa-enroll" element={<MfaEnrollPage />} />
          <Route path="/terms" element={<TermsPage />} />

          {/* App Routes — redirect to sign-in if not authenticated */}
          <Route path="/dashboard" element={isAuthenticated ? <Dashboard /> : <Navigate to="/" />} />
          <Route path="/calculator" element={isAuthenticated ? <ManualJCalculator /> : <Navigate to="/" />} />
          <Route path="/manual-d" element={isAuthenticated ? <ManualDCalculator /> : <Navigate to="/" />} />
          <Route path="/aed" element={isAuthenticated ? <AedAnalysis /> : <Navigate to="/" />} />
          <Route path="/manual-s" element={isAuthenticated ? <ManualSCalculator /> : <Navigate to="/" />} />
          <Route path="/reports" element={isAuthenticated ? <CombinedReportPage /> : <Navigate to="/" />} />
          <Route path="/settings" element={isAuthenticated ? <SettingsPage /> : <Navigate to="/" />} />
          <Route path="/guide" element={isAuthenticated ? <UserGuidePage /> : <Navigate to="/" />} />
          <Route path="/team" element={isAuthenticated ? <TeamPage /> : <Navigate to="/" />} />
          <Route path="/community" element={isAuthenticated ? <CommunityPage /> : <Navigate to="/" />} />
          <Route path="/community/:id" element={isAuthenticated ? <CommunityPage /> : <Navigate to="/" />} />
          <Route path="/permits" element={isAuthenticated ? <PermitsPage /> : <Navigate to="/" />} />
          <Route path="/permits/:id" element={isAuthenticated ? <PermitsPage /> : <Navigate to="/" />} />
          <Route path="/audit-log" element={isAuthenticated ? <AuditLogPage /> : <Navigate to="/" />} />
          <Route path="/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/" />} />
          <Route path="/project/:id/cad" element={isAuthenticated ? <CadWorkspace /> : <Navigate to="/" />} />

          {/* Platform admin (L0). Hard-gated again inside the page. */}
          <Route path="/admin" element={isAuthenticated ? <AdminPage /> : <Navigate to="/" />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
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
