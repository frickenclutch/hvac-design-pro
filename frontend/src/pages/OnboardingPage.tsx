import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore, type OrgType, type RegionCode, type Address } from '../features/auth/store/useAuthStore';
import { SecureInput, SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Building2, Globe, User, ArrowRight, ArrowLeft, ChevronRight, MapPin, Phone, Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck, Zap } from 'lucide-react';

interface InvitePreview {
  invitedEmail: string;
  invitedRole: string;
  expiresAt: string;
  organisation: { name: string; type: string; slug: string };
  inviter: { firstName: string | null; lastName: string | null; email: string };
}

export default function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  // When an invite token is present, take over the entire page with the
  // accept-invitation flow. The regular org-creation wizard is the fallback
  // for visitors without a token.
  if (inviteToken) {
    return <InviteAcceptance token={inviteToken} />;
  }

  return <OnboardingWizard />;
}

// ── Invite acceptance flow ─────────────────────────────────────────────────
// Steps: 1) fetch the invite preview to confirm it's valid + show the org
// they're joining; 2) collect first/last name + password; 3) POST redeem;
// 4) on success redirect to dashboard. The user arrives session-authenticated.

function InviteAcceptance({ token }: { token: string }) {
  const navigate = useNavigate();
  const { redeemInvite, logout, authLoading, authError, isAuthenticated, user, clearError } = useAuthStore();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Track whether we just successfully redeemed this invite. Without this
  // flag the redirect-after-auth would also fire on page MOUNT for a user
  // who's already signed in as someone else, bouncing them past the form
  // before they can accept. The flag flips true only after redeemInvite()
  // resolves, which is the actual moment we want to send them to /dashboard.
  const [redeemed, setRedeemed] = useState(false);

  // Fetch invite preview on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL || '';
        const res = await fetch(`${apiBase}/api/auth/invite/${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(body?.error ?? 'This invitation could not be loaded.');
        } else {
          setPreview(body as InvitePreview);
        }
      } catch {
        if (cancelled) return;
        setPreviewError('Unable to reach the server. Please check your connection.');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ONLY redirect after a successful redemption — never on page mount.
  // The redeemed flag plus isAuthenticated together mean "we just minted
  // the new session," not "the visitor is already signed in as someone
  // else." This is the bug the previous version had.
  useEffect(() => {
    if (redeemed && isAuthenticated) navigate('/dashboard', { replace: true });
  }, [redeemed, isAuthenticated, navigate]);

  // True when an existing session is in the way — the visitor is logged in
  // as someone OTHER than the email this invite was sent to. They can't
  // redeem cleanly without first releasing the existing session, because
  // both sessions can't coexist in this browser.
  const otherSessionInWay =
    isAuthenticated && !!user && !!preview && user.email !== preview.invitedEmail;

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    password.length >= 8 &&
    passwordsMatch &&
    !authLoading &&
    !otherSessionInWay;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    clearError();
    await redeemInvite(token, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      password,
    });
    // Mark redeemed so the navigation effect fires. If the redemption
    // failed (authError set), this still flips the flag but the effect
    // requires isAuthenticated which won't have changed → no redirect.
    setRedeemed(true);
  };

  const signOutAndStay = () => {
    logout();
    // Effect-driven re-render after logout will clear otherSessionInWay
    // and re-enable the form. No navigation needed — we want to stay on
    // this page so the visitor can complete redemption.
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-6 md:p-8 overflow-y-auto relative selection:bg-emerald-500/30 selection:text-emerald-300">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--color-slate-900),_var(--color-slate-950))] opacity-50" />

      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Accept invitation</h1>
            <p className="text-sm text-slate-400">Join your team on HVAC DesignPro</p>
          </div>
        </div>

        {previewLoading && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-400">Loading invitation…</span>
          </div>
        )}

        {!previewLoading && previewError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">Invitation unavailable</p>
                <p className="text-sm text-slate-400 mt-1">{previewError}</p>
              </div>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
            >
              Go to sign in
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {!previewLoading && preview && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Invitation summary */}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <p className="text-xs uppercase tracking-wider text-emerald-400/70 font-bold mb-2">You're invited</p>
              <p className="text-base text-white leading-snug">
                <span className="font-bold">{preview.inviter.firstName ?? preview.inviter.email}</span>
                {preview.inviter.lastName ? ` ${preview.inviter.lastName}` : ''} added you as a{' '}
                <span className="font-bold text-emerald-300">{preview.invitedRole}</span> on{' '}
                <span className="font-bold text-emerald-300">{preview.organisation.name}</span>.
              </p>
              <p className="text-xs text-slate-500 mt-3 font-mono">{preview.invitedEmail}</p>
            </div>

            {/* Existing-session conflict — happens when the inviter is
                using their own browser to test the invite, or when a
                visitor already has an account on a different tenant. The
                form is disabled until they sign out (or they can switch
                browsers/incognito to skip this entirely). */}
            {otherSessionInWay && user && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-200 mb-1">
                      You're signed in as a different account
                    </p>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      This browser has an active session for{' '}
                      <span className="font-mono text-slate-100">{user.email}</span>.
                      To accept the invitation for{' '}
                      <span className="font-mono text-slate-100">{preview.invitedEmail}</span>,
                      sign out first — or open the link in an incognito window to keep both accounts separate.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={signOutAndStay}
                  className="w-full px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-sm font-bold text-amber-200 min-h-[44px]"
                >
                  Sign out of {user.email} and continue
                </button>
              </div>
            )}

            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  First name
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Last name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Password
                <span className="text-slate-600 ml-1 normal-case">(min 8 characters)</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full pl-9 pr-10 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Confirm password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className={`w-full px-3 py-2.5 bg-slate-900 border rounded-xl text-white placeholder-slate-500 focus:outline-none min-h-[44px] ${
                  confirmPassword && !passwordsMatch
                    ? 'border-red-500/50 focus:border-red-500/70'
                    : 'border-slate-800 focus:border-emerald-500/50'
                }`}
              />
              {confirmPassword && !passwordsMatch && (
                <p className="text-xs text-red-400 mt-1.5">Passwords don't match</p>
              )}
            </div>

            {authError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{authError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full px-4 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed rounded-xl text-slate-950 font-bold flex items-center justify-center gap-2 transition-colors min-h-[48px] shadow-[0_0_20px_rgba(16,185,129,0.2)]"
            >
              {authLoading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                  Joining…
                </>
              ) : (
                <>
                  Accept &amp; join {preview.organisation.name}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-xs text-center text-slate-600">
              Expires {new Date(preview.expiresAt).toLocaleDateString()} ·{' '}
              <Link to="/login" className="text-slate-500 hover:text-slate-400 underline">
                Already have an account? Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Standard org-creation wizard ───────────────────────────────────────────

function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<OrgType | null>(null);
  const [region, setRegion] = useState<RegionCode>('NA_ASHRAE');

  // Org Details
  const [orgName, setOrgName] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgAddress, setOrgAddress] = useState<Address>({ line1: '', line2: '', city: '', state: '', zip: '', country: 'US' });

  // User Details
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [userPhone, setUserPhone] = useState('');

  const navigate = useNavigate();
  const { register, authLoading, authError, clearError } = useAuthStore();

  const handleComplete = async () => {
    if (!role || !orgName || !fullName || !email || !password) return;
    if (password !== confirmPassword) return;

    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ');

    await register({
      email,
      password,
      firstName,
      lastName,
      orgName,
      orgType: role,
      regionCode: region,
      addressLine1: orgAddress.line1 || undefined,
      city: orgAddress.city || undefined,
      state: orgAddress.state || undefined,
      zip: orgAddress.zip || undefined,
      country: orgAddress.country || undefined,
      phone: orgPhone || undefined,
    });

    const state = useAuthStore.getState();
    if (state.pendingVerification) {
      navigate('/verify-email');
    } else if (state.isAuthenticated) {
      setStep(5); // Show success
    }
  };

  const updateAddress = (field: keyof Address, value: string) => {
    setOrgAddress(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-6 md:p-8 overflow-y-auto relative selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Background Decor */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--color-slate-900),_var(--color-slate-950))] opacity-50" />
      
      <div className="relative w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="flex gap-2 mb-12">
          {[1, 2, 3, 4, 5].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${step >= s ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-slate-800'}`} />
          ))}
        </div>

        {/* Step 1: Role Selection */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Account Configuration</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Select your operational capacity within the platform.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RoleChoice 
                icon={<Building2 className="w-6 h-6" />}
                title="Company"
                description="Engineering teams & firms."
                selected={role === 'company'}
                className="border-emerald-500/20 bg-emerald-500/5"
                onClick={() => setRole('company')}
              />
              <RoleChoice 
                icon={<Globe className="w-6 h-6" />}
                title="Municipality"
                description="Regulatory & plan review."
                selected={role === 'municipality'}
                className="border-amber-500/20 bg-amber-500/5"
                onClick={() => setRole('municipality')}
              />
              <RoleChoice 
                icon={<User className="w-6 h-6" />}
                title="Individual"
                description="HVAC Contractor/Owner."
                selected={role === 'individual'}
                className="border-sky-500/20 bg-sky-500/5"
                onClick={() => setRole('individual')}
              />
            </div>
          </div>
        )}

        {/* Step 2: Coded Area Selection */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Regional Compliance</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Select the regulatory region for your calculations.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RegionChoice 
                title="North America"
                subtitle="ASHRAE/ACCA"
                description="IP Units (Fahrenheit, BTU/h, sqft)"
                selected={region === 'NA_ASHRAE'}
                onClick={() => setRegion('NA_ASHRAE')}
              />
              <RegionChoice 
                title="Europe"
                subtitle="EN Standard"
                description="SI Units (Celsius, Watts, sqm)"
                selected={region === 'EU_EN'}
                onClick={() => setRegion('EU_EN')}
              />
              <RegionChoice 
                title="United Kingdom"
                subtitle="CIBSE Guide"
                description="Mixed/SI Units"
                selected={region === 'UK_CIBSE'}
                onClick={() => setRegion('UK_CIBSE')}
              />
            </div>
          </div>
        )}

        {/* Step 3: Organisation Details */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Technical Headquarters</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Official address for report metadata and licensing.</p>
            
            <div className="space-y-4">
              <SecureInput 
                label="Organisation Name" 
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Engineering Firm LLC"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SecureInput 
                  label="Business Street Address" 
                  value={orgAddress.line1}
                  onChange={(e) => updateAddress('line1', e.target.value)}
                  placeholder="Street"
                  icon={<MapPin className="w-4 h-4" />}
                />
                <SecureInput 
                  label="Office/Suite" 
                  value={orgAddress.line2}
                  onChange={(e) => updateAddress('line2', e.target.value)}
                  placeholder="Lvl/Room"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SecureInput label="City" value={orgAddress.city} onChange={(e) => updateAddress('city', e.target.value)} placeholder="City" />
                <SecureInput label="State/Prov" value={orgAddress.state} onChange={(e) => updateAddress('state', e.target.value)} placeholder="State" />
                <SecureInput label="Postal Code" value={orgAddress.zip} onChange={(e) => updateAddress('zip', e.target.value)} placeholder="Zip" />
              </div>
              <SecureInput 
                label="Business Phone Number" 
                value={orgPhone}
                onChange={(e) => setOrgPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                icon={<Phone className="w-4 h-4" />}
              />
            </div>
          </div>
        )}

        {/* Step 4: Personal Profile + Credentials */}
        {step === 4 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Your Account</h1>
            <p className="text-slate-400 mb-10 text-lg leading-relaxed">Create your login credentials.</p>

            {authError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-in fade-in duration-200">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">{authError}</p>
                  <button onClick={clearError} className="text-xs text-red-400/60 hover:text-red-400 mt-1">Dismiss</button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <SecureInput
                label="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                icon={<User className="w-5 h-5" />}
              />
              <SecureInput
                label="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                icon={<Mail className="w-5 h-5" />}
              />
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Create a secure password"
                    autoComplete="new-password"
                    className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-4 pl-12 pr-12 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {password && password.length < 8 && (
                  <p className="text-xs text-amber-400 mt-1.5 ml-1">Password must be at least 8 characters</p>
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    autoComplete="new-password"
                    className={`w-full bg-slate-800/80 border rounded-2xl py-4 pl-12 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${confirmPassword && confirmPassword !== password ? 'border-red-500/60' : 'border-slate-700/60'}`}
                  />
                </div>
                {confirmPassword && confirmPassword !== password && (
                  <p className="text-xs text-red-400 mt-1.5 ml-1">Passwords do not match</p>
                )}
              </div>
              <SecureInput
                label="Phone (optional)"
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                icon={<Phone className="w-5 h-5" />}
              />

              <div className="mt-8">
                <SecurityBadge />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Success */}
        {step === 5 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-500 text-center py-12">
            <div className="w-20 h-20 mx-auto mb-8 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">Account Created</h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-md mx-auto mb-8">
              Welcome to HVAC DesignPro. Your engineering workspace is ready.
            </p>

            {/* Meet Mason — introduce the always-on assistant + feedback route */}
            <div className="max-w-md mx-auto mb-10 text-left rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4.5 h-4.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Meet Mason</p>
                  <p className="text-xs text-slate-400">Your AI assistant — and your one-tap line to our team.</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Look for Mason's little <span className="text-amber-400/90 font-semibold">fan orb</span> floating on
                every screen — drag it wherever you like and click it to open him. Spot a bug? His report form goes
                straight to the <span className="text-amber-400/90 font-semibold">C4 Technologies team of experts</span>.
              </p>
            </div>

            <button
              onClick={() => navigate('/dashboard')}
              className="bg-emerald-500 text-slate-950 px-12 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl inline-flex items-center gap-2"
            >
              Open Dashboard <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="mt-12 flex justify-between items-center px-1">
          {step > 1 && step < 5 ? (
            <button 
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 text-slate-500 hover:text-white font-bold transition-all p-2 rounded-xl hover:bg-slate-800/50"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          ) : <div />}
          
          {step < 4 ? (
            <button 
              disabled={step === 1 && !role}
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-2 bg-slate-100 text-slate-950 px-8 py-3.5 rounded-full font-bold hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-slate-950"
            >
              Next Component <ChevronRight className="w-5 h-5" />
            </button>
          ) : step === 4 ? (
            <button
              onClick={handleComplete}
              disabled={!fullName || !orgName || !email || !password || password.length < 8 || password !== confirmPassword || authLoading}
              className="flex items-center gap-2 bg-emerald-500 text-slate-950 px-10 py-4 rounded-full font-bold hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-slate-950"
            >
              {authLoading ? (
                <><div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" /> Creating Account...</>
              ) : (
                <>Create Account <ArrowRight className="w-5 h-5" /></>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RoleChoice({ icon, title, description, selected, onClick, className }: { icon: React.ReactNode, title: string, description: string, selected: boolean, onClick: () => void, className: string }) {
  return (
    <button 
      onClick={onClick}
      className={`relative glass-panel p-6 rounded-3xl border text-left transition-all duration-500 group ${className} ${selected ? 'border-opacity-100 shadow-[0_0_30px_rgba(16,185,129,0.1)] -translate-y-1' : 'border-opacity-10 translate-y-0 opacity-60 hover:opacity-100'}`}
    >
      <div className={`w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-900 border border-slate-700/50 mb-6 group-hover:scale-110 transition-transform shadow-xl ${selected ? 'text-white' : 'text-slate-500'}`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-2 leading-tight tracking-tight">{title}</h3>
      <p className="text-slate-500 text-sm leading-relaxed font-medium">{description}</p>
    </button>
  );
}

function RegionChoice({ title, subtitle, description, selected, onClick }: { title: string, subtitle: string, description: string, selected: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`glass-panel p-6 rounded-3xl border text-left transition-all duration-500 ${selected ? 'border-emerald-500/50 bg-emerald-500/5 shadow-xl -translate-y-1' : 'border-slate-800 opacity-60 hover:opacity-100'}`}
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-extrabold text-white leading-tight">{title}</h3>
        {selected && <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />}
      </div>
      <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2 opacity-80">{subtitle}</p>
      <p className="text-slate-500 text-xs leading-relaxed font-medium">{description}</p>
    </button>
  );
}
