import { useRef, useState, useEffect } from 'react';
import { usePreferencesStore, type ThemeMode, type UIDensity, type UnitSystem, type EngineVersion } from '../stores/usePreferencesStore';
import { Palette, Ruler, Grid3X3, Monitor, RotateCcw, Accessibility, FileText, Stamp, Upload, Trash2, Image, Building2, User, Save, BadgeCheck, ShieldCheck, Lock, Copy, Check, KeyRound, AlertCircle, Pencil, HardDrive } from 'lucide-react';
import { api } from '../lib/api';
import A11yPanel from '../components/accessibility/A11yPanel';
import TotpQr from '../components/TotpQr';
import FeedbackAnnotator from '../components/FeedbackAnnotator';
import cadPortalBlackhole from '../assets/brand/cad-portal-blackhole.png';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import { toast } from '../stores/useToastStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function SettingsPage() {
  const prefs = usePreferencesStore();
  const { user, organisation, token } = useAuthStore();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        {/* Portal-reflected hero — stepping into Settings is stepping through
            the Creation Portal: the same black-hole emblem, brushed-steel
            plate, and engraved ink. */}
        <header className="mb-8">
          <div className="portal-plate portal-menu-emerge relative overflow-hidden rounded-2xl border border-slate-700/70 p-5 sm:p-6 flex items-center gap-4 sm:gap-5 shadow-[0_16px_50px_rgba(0,0,0,0.6)]">
            <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
            {/* Spinning black-hole emblem — the portal trigger, at rest */}
            <div className="portal-button-metallic relative w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
              <span aria-hidden className="portal-ring-metallic absolute inset-[-50%]" />
              <span aria-hidden className="absolute inset-[2px] rounded-[14px] bg-slate-950/95" />
              <img src={cadPortalBlackhole} alt="" aria-hidden className="absolute inset-[2px] z-10 rounded-[14px] object-cover" />
            </div>
            <div className="relative z-10 min-w-0">
              <p className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-slate-800 [text-shadow:0_1px_0_rgba(255,255,255,0.55)]">Creation Portal</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 leading-tight [text-shadow:0_1px_0_rgba(255,255,255,0.5)]">Settings</h2>
              <p className="text-xs sm:text-sm font-semibold text-slate-800 [text-shadow:0_1px_0_rgba(255,255,255,0.6)]">Your workbench — you and your tenant, all in one place.</p>
            </div>
          </div>
        </header>

        <div className="space-y-8">
          {/* Organisation Profile */}
          <OrgProfileSection token={token} orgId={organisation?.id} />

          {/* Authority Profile — admin-gated, sits next to Org Profile.
              Shows whenever the user is an admin so they can configure
              their tenant as a permit authority. */}
          {user?.role === 'admin' && <AuthorityProfileSection />}

          {/* Access Policy — who in the tenant can see audit/version
              surfaces. Admin + L0 only. */}
          {(user?.role === 'admin' || user?.isPlatformAdmin) && <AccessPolicySection />}

          {/* Legacy Archive & Backup (Synology NAS) — tenant-admin config for
              routing records to the org's own NAS. Higher-tier capability. */}
          {user?.role === 'admin' && <SynologyBackupSection orgId={organisation?.id} />}

          {/* User Profile */}
          <UserProfileSection token={token} user={user} />

          {/* Multi-factor authentication — the session user manages their OWN
              second factor. Admins/L0 see a "required" banner. */}
          <MfaSection requiredForRole={user?.role === 'admin' || !!user?.isPlatformAdmin} />

          {/* Appearance */}
          <Section icon={<Palette className="w-5 h-5 text-violet-400" />} title="Appearance">
            <OptionGroup label="Theme">
              <ToggleRow
                options={[
                  { value: 'midnight', label: 'Midnight' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                value={prefs.theme}
                onChange={(v) => prefs.update({ theme: v as ThemeMode })}
              />
            </OptionGroup>

            <OptionGroup label="UI Density">
              <ToggleRow
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'spacious', label: 'Spacious' },
                ]}
                value={prefs.density}
                onChange={(v) => prefs.update({ density: v as UIDensity })}
              />
            </OptionGroup>

            <SwitchOption
              label="Animations"
              description="Smooth transitions and motion effects"
              checked={prefs.animationsEnabled}
              onChange={(v) => prefs.update({ animationsEnabled: v })}
            />

            <SwitchOption
              label="Tooltips"
              description="Show helpful tooltips on hover"
              checked={prefs.showTooltips}
              onChange={(v) => prefs.update({ showTooltips: v })}
            />
          </Section>

          {/* Units & Defaults */}
          <Section icon={<Ruler className="w-5 h-5 text-sky-400" />} title="Units & Defaults">
            <OptionGroup label="Unit System">
              <ToggleRow
                options={[
                  { value: 'imperial', label: 'Imperial (ft, °F)' },
                  { value: 'metric', label: 'Metric (m, °C)' },
                ]}
                value={prefs.units}
                onChange={(v) => prefs.update({ units: v as UnitSystem })}
              />
            </OptionGroup>

            <NumberOption
              label="Default Ceiling Height"
              suffix={prefs.units === 'imperial' ? 'ft' : 'm'}
              value={prefs.defaultCeilingHeight}
              onChange={(v) => prefs.update({ defaultCeilingHeight: v })}
            />

            <NumberOption
              label="Default Wall R-Value"
              value={prefs.defaultWallRValue}
              onChange={(v) => prefs.update({ defaultWallRValue: v })}
            />

            <NumberOption
              label="Default Window U-Value"
              value={prefs.defaultWindowUValue}
              onChange={(v) => prefs.update({ defaultWindowUValue: v })}
              step={0.1}
            />
          </Section>

          {/* CAD Workspace */}
          <Section icon={<Grid3X3 className="w-5 h-5 text-emerald-400" />} title="CAD Workspace">
            <SwitchOption
              label="Grid Snap"
              description="Snap drawing endpoints to the grid"
              checked={prefs.gridSnap}
              onChange={(v) => prefs.update({ gridSnap: v })}
            />

            <NumberOption
              label="Grid Spacing"
              suffix="px/ft"
              value={prefs.gridSpacing}
              onChange={(v) => prefs.update({ gridSpacing: v })}
            />

            <SwitchOption
              label="Autosave"
              description="Automatically save your work periodically"
              checked={prefs.autosave}
              onChange={(v) => prefs.update({ autosave: v })}
            />
          </Section>

          {/* Accessibility */}
          <Section icon={<Accessibility className="w-5 h-5 text-cyan-400" />} title="Accessibility">
            <A11yPanel />
          </Section>

          {/* PDF & Print Settings */}
          <Section icon={<FileText className="w-5 h-5 text-orange-400" />} title="PDF & Print Settings">
            <p className="text-xs text-slate-500 mb-4">Choose which sections to include when exporting PDF reports and blueprints.</p>

            <SwitchOption label="Floor Plan Drawing" description="Canvas plot on cover page" checked={prefs.pdfIncludeDrawing} onChange={(v) => prefs.update({ pdfIncludeDrawing: v })} />
            <SwitchOption label="Room & Wall Schedules" description="Room areas, wall lengths, R-values" checked={prefs.pdfIncludeRoomSchedule} onChange={(v) => prefs.update({ pdfIncludeRoomSchedule: v })} />
            <SwitchOption label="Opening & HVAC Schedules" description="Windows, doors, equipment tables" checked={prefs.pdfIncludeOpeningSchedule} onChange={(v) => prefs.update({ pdfIncludeOpeningSchedule: v })} />
            <SwitchOption label="Manual J Load Summary" description="Heating/cooling calculations (if available)" checked={prefs.pdfIncludeLoadSummary} onChange={(v) => prefs.update({ pdfIncludeLoadSummary: v })} />
            <SwitchOption label="Notes & Codes Page" description="Standard disclaimers and code references" checked={prefs.pdfIncludeNotes} onChange={(v) => prefs.update({ pdfIncludeNotes: v })} />

            <OptionGroup label="Page Size">
              <ToggleRow
                options={[
                  { value: 'letter', label: 'Letter' },
                  { value: 'a4', label: 'A4' },
                  { value: 'tabloid', label: 'Tabloid' },
                ]}
                value={prefs.pdfPageSize}
                onChange={(v) => prefs.update({ pdfPageSize: v as 'letter' | 'a4' | 'tabloid' })}
              />
            </OptionGroup>

            <OptionGroup label="Orientation">
              <ToggleRow
                options={[
                  { value: 'landscape', label: 'Landscape' },
                  { value: 'portrait', label: 'Portrait' },
                ]}
                value={prefs.pdfOrientation}
                onChange={(v) => prefs.update({ pdfOrientation: v as 'landscape' | 'portrait' })}
              />
            </OptionGroup>

            <OptionGroup label="Watermark Text">
              <input
                type="text"
                value={prefs.pdfWatermarkText}
                onChange={(e) => prefs.update({ pdfWatermarkText: e.target.value })}
                placeholder="Custom watermark text"
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </OptionGroup>
          </Section>

          {/* Blueprint Stamps */}
          <Section icon={<Stamp className="w-5 h-5 text-pink-400" />} title="Blueprint Stamps">
            <p className="text-xs text-slate-500 mb-4">Upload your firm's PE seal or notary stamp to automatically include on exported blueprints.</p>

            <StampUpload
              label="Firm / PE Seal"
              dataUrl={prefs.firmStampDataUrl}
              onUpload={(url) => prefs.update({ firmStampDataUrl: url })}
              onClear={() => prefs.update({ firmStampDataUrl: '' })}
            />

            {prefs.firmStampDataUrl && (
              <OptionGroup label="Stamp Position">
                <ToggleRow
                  options={[
                    { value: 'top-left', label: 'Top Left' },
                    { value: 'top-right', label: 'Top Right' },
                    { value: 'bottom-left', label: 'Bottom Left' },
                    { value: 'bottom-right', label: 'Bottom Right' },
                  ]}
                  value={prefs.firmStampPosition}
                  onChange={(v) => prefs.update({ firmStampPosition: v as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' })}
                />
              </OptionGroup>
            )}

            <div className="my-3 border-t border-slate-800/40" />

            <StampUpload
              label="Notary Stamp"
              dataUrl={prefs.notaryStampDataUrl}
              onUpload={(url) => prefs.update({ notaryStampDataUrl: url })}
              onClear={() => prefs.update({ notaryStampDataUrl: '' })}
            />
          </Section>

          {/* Professional Engineer (PE) Stamp & Attestation */}
          <Section icon={<BadgeCheck className="w-5 h-5 text-amber-400" />} title="PE Stamp & Attestation">
            <p className="text-xs text-slate-500 mb-4">
              Configure your Professional Engineer credentials and signature for the permit-ready attestation page on
              combined reports. The attestation page appears <span className="font-semibold text-slate-400">only</span> when
              both your name and a signature image are set — otherwise combined reports export exactly as before. These outputs
              remain a calculation aid requiring your independent professional review; you sign as the responsible engineer of record.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ProfileInput
                label="Engineer Name"
                value={prefs.peName}
                onChange={(v) => prefs.update({ peName: v })}
                placeholder="John A. Smith, PE"
              />
              <ProfileInput
                label="PE License Number"
                value={prefs.peLicenseNumber}
                onChange={(v) => prefs.update({ peLicenseNumber: v })}
                placeholder="M-12345"
              />
              <ProfileInput
                label="Jurisdiction"
                value={prefs.peJurisdiction}
                onChange={(v) => prefs.update({ peJurisdiction: v })}
                placeholder="Maryland"
              />
            </div>

            <div className="my-3 border-t border-slate-800/40" />

            <StampUpload
              label="PE Signature Image"
              dataUrl={prefs.peSignatureDataUrl}
              onUpload={(url) => prefs.update({ peSignatureDataUrl: url })}
              onClear={() => prefs.update({ peSignatureDataUrl: '' })}
            />

            {prefs.peName && prefs.peLicenseNumber && prefs.peSignatureDataUrl ? (
              <div className="flex items-start gap-2 px-3 py-2 mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                <BadgeCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Attestation page is active. Combined reports will include a signed PE attestation with a SHA-256 content hash for tamper-evidence.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 mt-3 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs text-slate-400">
                <BadgeCheck className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                <span>Set an engineer name, PE license number, and a signature image to enable the attestation page. Until then, combined reports stay unchanged.</span>
              </div>
            )}
          </Section>

          {/* Calculation Engine — gated to platform admins until ACCA cert review approves and Phase 2 cutover ships */}
          {user?.isPlatformAdmin && (
            <Section icon={<BadgeCheck className="w-5 h-5 text-amber-400" />} title="Calculation Engine (Beta)">
              <p className="text-xs text-slate-500 mb-4">
                Cert-grade Manual J 8th Ed v2.50 engine — currently shadow-running alongside the legacy engine in production. Gated to platform admins until ACCA cert review approves. See <a href="/guide" className="text-amber-400 hover:underline">User Guide → Cert-Grade Manual J Engine</a> for the full rollout plan.
              </p>

              <OptionGroup label="Active Engine">
                <ToggleRow
                  options={[
                    { value: 'legacy', label: 'Legacy (per-room)' },
                    { value: 'manualJ8', label: 'Cert-grade (whole-house)' },
                  ]}
                  value={prefs.engineVersion}
                  onChange={(v) => prefs.update({ engineVersion: v as EngineVersion })}
                />
              </OptionGroup>

              <SwitchOption
                label="Shadow-run cert engine on every calc"
                description="Runs the cert-grade engine alongside legacy and logs [engine drift] to console. Off by default for non-admins; on for telemetry collection."
                checked={prefs.shadowRunManualJ8}
                onChange={(v) => prefs.update({ shadowRunManualJ8: v })}
              />

              {prefs.engineVersion === 'manualJ8' && (
                <div className="flex items-start gap-2 px-3 py-2 mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                  <span className="font-bold uppercase tracking-wider text-[10px] flex-shrink-0">Heads up</span>
                  <span>Cert-grade engine selected. Display flips to cert-grade results on the next calc. Phase 2 inverse-adapter for per-room display is not yet shipped — room cards may show approximated loads. Switch back to legacy if results look off.</span>
                </div>
              )}
            </Section>
          )}

          {/* System */}
          <Section icon={<Monitor className="w-5 h-5 text-amber-400" />} title="System">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-white">App Version</p>
                <p className="text-xs text-slate-500">HVAC DesignPro PWA</p>
              </div>
              <span className="text-xs font-mono text-slate-500 bg-slate-800 px-3 py-1 rounded-lg">v1.0.0</span>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-white">Storage Used</p>
                <p className="text-xs text-slate-500">Projects, preferences, and cached assets</p>
              </div>
              <button
                onClick={() => { if (confirm('Clear all local data?')) { localStorage.clear(); location.reload(); } }}
                className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
              >
                Clear Data
              </button>
            </div>

            <button
              onClick={prefs.reset}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800/50 border border-slate-700/30 text-slate-400 hover:text-white hover:border-slate-600 transition-all text-sm font-semibold"
            >
              <RotateCcw className="w-4 h-4" /> Reset All Preferences
            </button>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-700/60 overflow-hidden shadow-[0_10px_36px_rgba(0,0,0,0.45)]">
      {/* Machined header strip — the same brushed-steel plate, sheen, enamel
          icon chip, and engraved ink as the Creation Portal menu. */}
      <div className="portal-plate relative px-5 py-3.5 flex items-center gap-3">
        <span aria-hidden className="portal-menu-sheen absolute inset-0 pointer-events-none" />
        <span className="relative z-10 w-9 h-9 rounded-xl bg-slate-900 border-2 border-slate-950/60 flex items-center justify-center shrink-0 shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),0_2px_5px_rgba(0,0,0,0.5)]">
          {icon}
        </span>
        <h3 className="relative z-10 text-sm font-bold text-slate-950 uppercase tracking-widest [text-shadow:0_1px_0_rgba(255,255,255,0.5)]">{title}</h3>
      </div>
      {/* Dark body keeps the form controls legible below the metal header. */}
      <div className="bg-slate-900/60 backdrop-blur-xl p-6 space-y-5 border-t border-slate-950/50">{children}</div>
    </section>
  );
}

// ── MFA (TOTP) management ─────────────────────────────────────────────────────
// The authed enrollment/management surface for the SESSION user's OWN factor.
// All calls go through api.mfa* (Bearer + 401-refresh handled by lib/api.ts).
// Disabled → "Enable" → show secret + otpauth URI + 6-digit verify → show backup
// codes once → enabled. Enabled → status + "Disable" (prompts for a current
// TOTP/backup code).
type MfaPhase = 'idle' | 'enrolling' | 'backup' | 'disabling';

function MfaSection({ requiredForRole }: { requiredForRole: boolean }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [phase, setPhase] = useState<MfaPhase>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'secret' | 'backup' | null>(null);

  const refresh = async () => {
    try {
      const s = await api.mfaStatus();
      setEnabled(s.enabled);
      setBackupRemaining(s.backupCodesRemaining);
    } catch { /* toast already shown by api client */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const r = await api.mfaEnrollStart();
      setSecret(r.secret);
      setOtpauthUri(r.otpauthUri);
      setCode('');
      setPhase('enrolling');
    } catch { /* api toast */ }
    finally { setBusy(false); }
  };

  const confirmEnroll = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      const r = await api.mfaConfirm(code);
      setBackupCodes(r.backupCodes);
      setCode('');
      setPhase('backup');
      setEnabled(true);
      toast.success('Two-factor authentication enabled.');
    } catch { /* api toast */ }
    finally { setBusy(false); }
  };

  const confirmDisable = async () => {
    if (!code) return;
    setBusy(true);
    try {
      await api.mfaDisable(code);
      setEnabled(false);
      setBackupRemaining(0);
      setCode('');
      setPhase('idle');
      toast.success('Two-factor authentication disabled.');
    } catch { /* api toast */ }
    finally { setBusy(false); }
  };

  const copy = async (text: string, which: 'secret' | 'backup') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <Section icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />} title="Two-Factor Authentication">
      {requiredForRole && !enabled && phase === 'idle' && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300 font-medium">
            Your role requires two-factor authentication. Enable it now — you'll be prompted to set it up on your next sign-in otherwise.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : phase === 'idle' && !enabled ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400 leading-relaxed">
            Add an authenticator app (Google Authenticator, Authy, 1Password) as a second factor. You'll enter a 6-digit code at sign-in.
          </p>
          <button
            onClick={startEnroll}
            disabled={busy}
            className="flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 py-3 px-6 rounded-xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50 min-h-[44px]"
          >
            <Lock className="w-4 h-4" /> Enable Authenticator
          </button>
        </div>
      ) : phase === 'idle' && enabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm text-emerald-300 font-bold">Authenticator app enabled</p>
              <p className="text-xs text-slate-400 mt-0.5">{backupRemaining} backup code{backupRemaining === 1 ? '' : 's'} remaining</p>
            </div>
          </div>
          <button
            onClick={() => { setCode(''); setPhase('disabling'); }}
            className="flex items-center justify-center gap-2 border border-red-500/30 text-red-300 py-3 px-6 rounded-xl font-bold hover:bg-red-500/10 transition-all min-h-[44px]"
          >
            Disable
          </button>
        </div>
      ) : phase === 'enrolling' ? (
        <div className="space-y-5">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 block text-center">Scan with your authenticator app</label>
            <TotpQr uri={otpauthUri} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Can't scan? Enter this secret manually</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-xl py-3 px-4 text-emerald-300 font-mono text-sm break-all">{secret}</code>
              <button
                type="button"
                onClick={() => copy(secret, 'secret')}
                className="p-3 rounded-xl border border-slate-700/60 bg-slate-800/50 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Copy secret"
              >
                {copied === 'secret' ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Enter the 6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full bg-slate-900/80 border border-slate-700/60 rounded-xl py-4 px-6 text-white text-center text-2xl font-mono tracking-[0.4em] placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={confirmEnroll}
              disabled={busy || code.length !== 6}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50 min-h-[44px]"
            >
              {busy ? <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" /> : 'Verify & Enable'}
            </button>
            <button
              onClick={() => { setPhase('idle'); setCode(''); }}
              className="px-5 border border-slate-700/60 text-slate-400 rounded-xl font-bold hover:bg-slate-800/50 transition-all min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : phase === 'backup' ? (
        <div className="space-y-5">
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">One-time backup codes</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">Save these somewhere safe. Each works once if you lose your device.</p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm text-amber-200">
              {backupCodes.map((bc) => (
                <div key={bc} className="bg-slate-900/60 rounded-lg py-2 px-3 text-center tracking-wider">{bc}</div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => copy(backupCodes.join('\n'), 'backup')}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/30 text-amber-300 font-bold text-sm hover:bg-amber-500/10 transition-all min-h-[44px]"
            >
              {copied === 'backup' ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy all codes</>}
            </button>
          </div>
          <button
            onClick={() => { setBackupCodes([]); setPhase('idle'); void refresh(); }}
            className="w-full bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all min-h-[44px]"
          >
            Done
          </button>
        </div>
      ) : phase === 'disabling' ? (
        <div className="space-y-5">
          <p className="text-sm text-slate-400 leading-relaxed">
            Enter a current 6-digit code from your authenticator app, or one of your backup codes, to disable two-factor authentication.
          </p>
          <input
            type="text"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value.trim())}
            placeholder="Code or backup code"
            className="w-full bg-slate-900/80 border border-slate-700/60 rounded-xl py-4 px-6 text-white text-center text-xl font-mono tracking-[0.2em] placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500/30 transition-all"
          />
          <div className="flex gap-3">
            <button
              onClick={confirmDisable}
              disabled={busy || !code}
              className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-400 transition-all disabled:opacity-50 min-h-[44px]"
            >
              {busy ? <div className="w-5 h-5 border-2 border-red-200 border-t-transparent rounded-full animate-spin" /> : 'Disable 2FA'}
            </button>
            <button
              onClick={() => { setPhase('idle'); setCode(''); }}
              className="px-5 border border-slate-700/60 text-slate-400 rounded-xl font-bold hover:bg-slate-800/50 transition-all min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{label}</label>
      {children}
    </div>
  );
}

function ToggleRow({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex bg-slate-900/80 rounded-xl p-1 border border-slate-800/40">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${value === opt.value ? 'bg-slate-700/80 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SwitchOption({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-all relative ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}
      >
        <div className={`w-4.5 h-4.5 rounded-full bg-white shadow-md absolute top-0.5 transition-all ${checked ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function StampUpload({ label, dataUrl, onUpload, onClear }: { label: string; dataUrl: string; onUpload: (url: string) => void; onClear: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onUpload(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div>
      <p className="text-sm font-semibold text-white mb-2">{label}</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
      {dataUrl ? (
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden flex items-center justify-center p-1">
            <img src={dataUrl} alt={label} className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => fileRef.current?.click()} className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"><Upload className="w-3 h-3" /> Replace</button>
            <button onClick={onClear} className="text-xs font-bold text-red-400 hover:text-red-300 flex items-center gap-1.5"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-6 rounded-xl border-2 border-dashed border-slate-700/50 bg-slate-800/20 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all flex flex-col items-center gap-2 text-slate-500 hover:text-slate-300"
        >
          <Image className="w-6 h-6" />
          <span className="text-xs font-semibold">Click to upload {label.toLowerCase()}</span>
          <span className="text-[10px] text-slate-600">PNG, JPG — Max 2MB</span>
        </button>
      )}
    </div>
  );
}

// Avatar that represents the user everywhere (menu, sidebar, Creation Portal).
// Upload → optionally mark it up with the platform's own drawing tool
// (FeedbackAnnotator, the same editor the bug reporter uses) → save. Stored as
// a data URL in preferences (per-user scoped, quota-managed).
function AvatarField({ initials }: { initials: string }) {
  const avatarDataUrl = usePreferencesStore(s => s.avatarDataUrl);
  const update = usePreferencesStore(s => s.update);
  const fileRef = useRef<HTMLInputElement>(null);
  // The image currently open in the annotator (null = closed).
  const [editing, setEditing] = useState<string | null>(null);

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast.error('Image must be under 4MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setEditing(reader.result); };
    reader.onerror = () => toast.error('Could not read that image.');
    reader.readAsDataURL(file);
  };

  const handleDone = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') { update({ avatarDataUrl: reader.result }); toast.success('Avatar updated.'); }
      setEditing(null);
    };
    reader.onerror = () => { toast.error('Could not save that avatar.'); setEditing(null); };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-5 pb-5 mb-5 border-b border-slate-800/60">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} className="hidden" />
      <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
        {avatarDataUrl
          ? <img src={avatarDataUrl} alt="Your avatar" className="w-full h-full object-cover" />
          : <span className="text-2xl font-bold text-emerald-400 select-none">{initials}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">Profile photo</p>
        <p className="text-xs text-slate-500 mb-3">Represents you across the platform. Add a few marks with the drawing tool before you save.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 bg-sky-500/10 border border-sky-500/30 px-3 py-2 rounded-lg transition-colors">
            <Upload className="w-3.5 h-3.5" /> {avatarDataUrl ? 'Replace' : 'Upload'}
          </button>
          {avatarDataUrl && (
            <>
              <button onClick={() => setEditing(avatarDataUrl)} className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-700/40 border border-slate-600/40 px-3 py-2 rounded-lg transition-colors">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={() => { update({ avatarDataUrl: '' }); toast.success('Avatar removed.'); }} className="flex items-center gap-1.5 text-xs font-bold text-red-400 hover:text-red-300 bg-red-500/5 border border-red-500/20 px-3 py-2 rounded-lg transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </>
          )}
        </div>
        <p className="text-[10px] text-slate-600 mt-2">PNG, JPG, or WebP — max 4MB. Stored on this device.</p>
      </div>
      {editing && (
        <FeedbackAnnotator imageDataUrl={editing} onDone={handleDone} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Legacy Archive & Backup (Synology NAS) ─────────────────────────────────
// Tenant-admin surface for routing permit-grade records + drawings to the
// org's own Synology NAS — the same appliance C4 Technologies runs for its
// MSP clients. Two integration shapes: a WEBHOOK the platform POSTs archive
// events to, or the org's Synology API endpoint. No credentials are ever held
// here (CLAUDE.md §2 — no secrets in the frontend); this panel captures the
// POLICY. The server-side delivery worker (fires on the selected events and
// authenticates against the NAS with a server-held secret) is the follow-up
// unit — the config is stored so that worker has something to read.
interface BackupConfig {
  enabled: boolean;
  mode: 'webhook' | 'api';
  endpointUrl: string;
  sharePath: string;
  events: { projects: boolean; calculations: boolean; cadDrawings: boolean; permits: boolean; exports: boolean };
}

const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: false,
  mode: 'webhook',
  endpointUrl: '',
  sharePath: '/hvac-design-pro',
  events: { projects: true, calculations: true, cadDrawings: true, permits: true, exports: false },
};

function backupKey(orgId?: string) { return `hvac_synology_backup_${orgId || 'org'}`; }

function loadBackupConfig(orgId?: string): BackupConfig {
  try {
    const raw = localStorage.getItem(backupKey(orgId));
    if (!raw) return DEFAULT_BACKUP_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BACKUP_CONFIG, ...parsed, events: { ...DEFAULT_BACKUP_CONFIG.events, ...(parsed.events ?? {}) } };
  } catch { return DEFAULT_BACKUP_CONFIG; }
}

function SynologyBackupSection({ orgId }: { orgId?: string }) {
  const [config, setConfig] = useState<BackupConfig>(() => loadBackupConfig(orgId));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setConfig(loadBackupConfig(orgId)); }, [orgId]);

  const patch = (p: Partial<BackupConfig>) => setConfig(c => ({ ...c, ...p }));
  const patchEvent = (k: keyof BackupConfig['events'], v: boolean) =>
    setConfig(c => ({ ...c, events: { ...c.events, [k]: v } }));

  const save = () => {
    setSaving(true);
    try {
      const clean: BackupConfig = { ...config, endpointUrl: config.endpointUrl.trim(), sharePath: config.sharePath.trim() };
      if (clean.enabled && !clean.endpointUrl) {
        toast.error('Enter your NAS endpoint before enabling backup.');
        setSaving(false); return;
      }
      if (clean.endpointUrl && !/^https?:\/\//i.test(clean.endpointUrl)) {
        toast.error('Endpoint must start with http:// or https://');
        setSaving(false); return;
      }
      localStorage.setItem(backupKey(orgId), JSON.stringify(clean));
      setConfig(clean);
      toast.success('Backup policy saved.');
    } catch {
      toast.error('Could not save backup policy.');
    }
    setSaving(false);
  };

  return (
    <Section icon={<HardDrive className="w-5 h-5 text-amber-400" />} title="Legacy Archive & Backup">
      <div className="flex gap-2.5 items-start mb-5 p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-xs text-amber-200/90">
        <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Archive permit-grade records and drawings to your own <strong>Synology NAS</strong> — the same
          appliance C4&nbsp;Technologies runs for its MSP clients. Included on <strong>Professional</strong> and
          <strong> Enterprise</strong> plans; your workspace plan governs activation.
        </span>
      </div>

      <SwitchOption
        label="Enable NAS archiving"
        description="Push a copy of the selected records to your Synology appliance"
        checked={config.enabled}
        onChange={v => patch({ enabled: v })}
      />

      <div className={config.enabled ? '' : 'opacity-50 pointer-events-none select-none'}>
        <OptionGroup label="Integration">
          <ToggleRow
            options={[
              { value: 'webhook', label: 'Webhook (we POST to you)' },
              { value: 'api', label: 'Synology API' },
            ]}
            value={config.mode}
            onChange={(v) => patch({ mode: v as BackupConfig['mode'] })}
          />
        </OptionGroup>

        <ProfileInput
          label={config.mode === 'webhook' ? 'Webhook URL' : 'Synology API endpoint'}
          value={config.endpointUrl}
          onChange={v => patch({ endpointUrl: v })}
          placeholder={config.mode === 'webhook' ? 'https://nas.yourfirm.com/webhook/hvac' : 'https://nas.yourfirm.com:5001/webapi'}
        />
        <div className="mt-4">
          <ProfileInput
            label="Destination share / folder"
            value={config.sharePath}
            onChange={v => patch({ sharePath: v })}
            placeholder="/hvac-design-pro"
          />
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-white mb-1">Archive these events</p>
          <p className="text-xs text-slate-500 mb-2">Each selected event pushes a copy to the NAS when it happens.</p>
          <SwitchOption label="Projects" description="Project records and metadata" checked={config.events.projects} onChange={v => patchEvent('projects', v)} />
          <SwitchOption label="Calculations" description="Manual J / D / S results (append-only snapshots)" checked={config.events.calculations} onChange={v => patchEvent('calculations', v)} />
          <SwitchOption label="CAD drawings" description="Saved drawings and version history" checked={config.events.cadDrawings} onChange={v => patchEvent('cadDrawings', v)} />
          <SwitchOption label="Permit submissions" description="Submittal packets and lifecycle records" checked={config.events.permits} onChange={v => patchEvent('permits', v)} />
          <SwitchOption label="PDF exports" description="Generated permit-ready plots and reports" checked={config.events.exports} onChange={v => patchEvent('exports', v)} />
        </div>

        <div className="flex gap-2.5 items-start mt-5 p-3 rounded-xl border border-slate-700/40 bg-slate-800/30 text-[11px] text-slate-400">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400/70" />
          <span>
            Credentials are never entered or stored here. Configure NAS authentication on your appliance
            (webhook secret) or in the platform's server-side secret store. This panel sets the policy;
            the platform delivers the archives to it.
          </span>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 bg-amber-500/10 text-amber-300 border border-amber-500/30 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-500/20 transition-all disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Backup Policy'}
        </button>
      </div>
    </Section>
  );
}

function NumberOption({ label, suffix, value, onChange, step = 1 }: { label: string; suffix?: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm font-semibold text-white">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 bg-slate-900/80 border border-slate-700/50 rounded-lg py-1.5 px-3 text-white text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        {suffix && <span className="text-xs text-slate-500 font-mono w-8">{suffix}</span>}
      </div>
    </div>
  );
}

function ProfileInput({ label, value, onChange, placeholder, readOnly }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; readOnly?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function OrgProfileSection({ token, orgId }: { token: string | null; orgId?: string }) {
  const [orgData, setOrgData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token || !orgId) return;
    fetch(`${API_BASE}/api/org`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.organisation) {
          setOrgData(data.organisation);
          setLoaded(true);
        }
      })
      .catch(() => { toast.error('Failed to load organisation profile.'); });
  }, [token, orgId]);

  const saveOrg = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/org`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(orgData),
      });
      if (!res.ok) throw new Error();
      toast.success('Organisation profile saved.');
    } catch {
      toast.error('Failed to save organisation profile.');
    }
    setSaving(false);
  };

  const update = (key: string, value: string) => setOrgData(prev => ({ ...prev, [key]: value }));

  if (!loaded) return null;

  return (
    <Section icon={<Building2 className="w-5 h-5 text-emerald-400" />} title="Organisation Profile">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ProfileInput label="Organisation Name" value={orgData.name || ''} onChange={v => update('name', v)} />
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Type</label>
          <select
            value={orgData.orgType || 'individual'}
            onChange={e => update('orgType', e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="individual">Individual</option>
            <option value="company">Company</option>
            <option value="municipality">Municipality</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Region / Standard</label>
          <select
            value={orgData.regionCode || 'NA_ASHRAE'}
            onChange={e => update('regionCode', e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="NA_ASHRAE">North America (ACCA/ASHRAE)</option>
            <option value="EU_EN">Europe (EN 12831)</option>
            <option value="UK_CIBSE">UK (CIBSE)</option>
            <option value="CA_CSA">Canada (CSA F280)</option>
            <option value="AU_NZS">Australia/NZ (AS/NZS)</option>
          </select>
        </div>
        <ProfileInput label="Phone" value={orgData.phone || ''} onChange={v => update('phone', v)} placeholder="(555) 123-4567" />
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ProfileInput label="Address" value={orgData.addressLine1 || ''} onChange={v => update('addressLine1', v)} placeholder="123 Main St" />
        <ProfileInput label="City" value={orgData.city || ''} onChange={v => update('city', v)} placeholder="Chicago" />
        <ProfileInput label="State" value={orgData.state || ''} onChange={v => update('state', v)} placeholder="IL" />
        <ProfileInput label="ZIP" value={orgData.zip || ''} onChange={v => update('zip', v)} placeholder="60601" />
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={saveOrg} disabled={saving}
          className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-500/20 transition-all disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Organisation'}
        </button>
      </div>
    </Section>
  );
}

function UserProfileSection({ token, user }: { token: string | null; user: { id: string; firstName: string; lastName: string; email: string } | null }) {
  const [profile, setProfile] = useState({ firstName: user?.firstName || '', lastName: user?.lastName || '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/org/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setProfile({ firstName: data.user.firstName || '', lastName: data.user.lastName || '', phone: data.user.phone || '' });
        }
      })
      .catch(() => { toast.error('Failed to load user profile.'); });
  }, [token]);

  const saveProfile = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/org/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error();
      toast.success('User profile saved.');
    } catch {
      toast.error('Failed to save user profile.');
    }
    setSaving(false);
  };

  if (!user) return null;

  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <Section icon={<User className="w-5 h-5 text-sky-400" />} title="User Profile">
      <AvatarField initials={initials} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ProfileInput label="First Name" value={profile.firstName} onChange={v => setProfile(p => ({ ...p, firstName: v }))} />
        <ProfileInput label="Last Name" value={profile.lastName} onChange={v => setProfile(p => ({ ...p, lastName: v }))} />
        <ProfileInput label="Email" value={user.email} onChange={() => {}} readOnly />
        <ProfileInput label="Phone" value={profile.phone} onChange={v => setProfile(p => ({ ...p, phone: v }))} placeholder="(555) 123-4567" />
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={saveProfile} disabled={saving}
          className="flex items-center gap-2 bg-sky-500/10 text-sky-400 border border-sky-500/30 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-sky-500/20 transition-all disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </Section>
  );
}

// Authority profile — declares the tenant as a permit authority.
// Admin-only. Shown to any admin so they can opt their tenant in;
// configuring this does not by itself make existing users authority
// members — admin still has to flip is_permit_authority on each
// inspector/reviewer via the Team page.
function AuthorityProfileSection() {
  const [authorityType, setAuthorityType] = useState<string | null>(null);
  const [authorityTitle, setAuthorityTitle] = useState('');
  const [statesText, setStatesText] = useState('');
  const [countiesText, setCountiesText] = useState('');
  const [zipsText, setZipsText] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [intakeEmail, setIntakeEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.authorityGetProfile()
      .then((r) => {
        setAuthorityType(r.authority.authorityType);
        setAuthorityTitle(r.authority.authorityTitle ?? '');
        setStatesText(r.authority.jurisdictionStates.join(', '));
        setCountiesText(r.authority.jurisdictionCounties.join('\n'));
        setZipsText(r.authority.jurisdictionZips.join(', '));
        setIntakeNotes(r.authority.intakeNotes ?? '');
        setIntakeEmail(r.authority.intakeEmail ?? '');
      })
      .catch(() => { /* best-effort hydrate; defaults stay */ })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.authorityPutProfile({
        authorityType,
        authorityTitle: authorityTitle.trim() || null,
        jurisdictionStates: statesText.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
        jurisdictionCounties: countiesText.split('\n').map(s => s.trim()).filter(Boolean),
        jurisdictionZips: zipsText.split(',').map(s => s.trim()).filter(s => /^\d{5}$/.test(s)),
        intakeNotes: intakeNotes.trim() || null,
        intakeEmail: intakeEmail.trim() || null,
      });
      toast.success('Authority profile saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save authority profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const isConfigured = !!authorityType;

  return (
    <Section icon={<ShieldCheck className="w-5 h-5 text-amber-400" />} title="Authority Profile">
      <p className="text-xs text-slate-500 mb-4">
        Configure your tenant as a permit authority — code enforcement, building department, fire marshal, plan reviewer, etc.
        After saving here, designate which of your team members can act on incoming submissions via the <a href="/team" className="text-amber-400 hover:underline">Team page</a> (toggle "Permit Authority" on each member).
      </p>

      {!isConfigured && (
        <div className="flex items-start gap-2 px-3 py-2 mb-4 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
          <span>Not configured. Pick an authority type below to opt in. Most tenants leave this off — only municipalities and code-enforcement contractors need it.</span>
        </div>
      )}

      <OptionGroup label="Authority Type">
        <select
          value={authorityType ?? ''}
          onChange={(e) => setAuthorityType(e.target.value || null)}
          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        >
          <option value="">Not an authority</option>
          <option value="building_dept">Building Department</option>
          <option value="fire_marshal">Fire Marshal</option>
          <option value="zoning">Zoning</option>
          <option value="mechanical">Mechanical</option>
          <option value="plumbing">Plumbing</option>
          <option value="electrical">Electrical</option>
          <option value="environmental">Environmental</option>
          <option value="general">General (multi-discipline)</option>
        </select>
      </OptionGroup>

      <OptionGroup label="Display Title (how submitters see your reviewers)">
        <input
          value={authorityTitle}
          onChange={(e) => setAuthorityTitle(e.target.value)}
          placeholder="e.g. Building Inspector, Code Enforcement Officer, Plan Reviewer"
          maxLength={120}
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
      </OptionGroup>

      <OptionGroup label="Jurisdiction — States (2-letter codes, comma-separated)">
        <input
          value={statesText}
          onChange={(e) => setStatesText(e.target.value)}
          placeholder="NY, NJ, CT"
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
        />
      </OptionGroup>

      <OptionGroup label="Jurisdiction — Counties (one per line, format “County, ST”)">
        <textarea
          value={countiesText}
          onChange={(e) => setCountiesText(e.target.value)}
          rows={3}
          placeholder={'Onondaga, NY\nOswego, NY'}
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono resize-y"
        />
      </OptionGroup>

      <OptionGroup label="Jurisdiction — ZIP codes (5-digit, comma-separated)">
        <textarea
          value={zipsText}
          onChange={(e) => setZipsText(e.target.value)}
          rows={2}
          placeholder="13202, 13203, 13204"
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono resize-y"
        />
      </OptionGroup>

      <OptionGroup label="Intake Process Notes (visible to submitters before they submit)">
        <textarea
          value={intakeNotes}
          onChange={(e) => setIntakeNotes(e.target.value)}
          rows={4}
          placeholder="Describe any steps required beyond the digital submission itself — e.g. site visit, hard-copy plans, fee payment, scheduling phone number, response timeline."
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y"
        />
      </OptionGroup>

      <OptionGroup label="Intake Notification Email (optional — Phase 2 email delivery target)">
        <input
          type="email"
          value={intakeEmail}
          onChange={(e) => setIntakeEmail(e.target.value)}
          placeholder="permits@yourdept.gov"
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40 font-mono"
        />
      </OptionGroup>

      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-500/20 transition-all disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Authority Profile'}
        </button>
      </div>
    </Section>
  );
}

// ── Access Policy ─────────────────────────────────────────────────────────────
// Tenant admin (or L0) decides which roles can reach the compliance /
// forensic surfaces. Defaults implement "Option C":
//   versionView=viewer (everyone with org access — it's their own work)
//   versionRestore=admin (destructive overwrite stays with admins + L0)
//   auditView=admin (oversight tool, not a working tool)
// The server re-enforces this on every request; this editor is the
// owner's control surface.
const ROLE_OPTIONS: { value: 'viewer' | 'tech' | 'engineer' | 'admin'; label: string }[] = [
  { value: 'viewer', label: 'Everyone (viewer+)' },
  { value: 'tech', label: 'Tech and up' },
  { value: 'engineer', label: 'Engineer and up' },
  { value: 'admin', label: 'Admin only' },
];

function AccessPolicySection() {
  const storePolicy = useAccessPolicyStore((s) => s.policy);
  const refreshPolicy = useAccessPolicyStore((s) => s.refresh);

  const [versionView, setVersionView] = useState<string>('viewer');
  const [versionRestore, setVersionRestore] = useState<string>('admin');
  const [auditView, setAuditView] = useState<string>('admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getAccessPolicy();
        if (cancelled) return;
        setVersionView(res.policy.versionView);
        setVersionRestore(res.policy.versionRestore);
        setAuditView(res.policy.auditView);
      } catch {
        // Fall back to whatever the store cached, else Option C defaults.
        if (storePolicy && !cancelled) {
          setVersionView(storePolicy.versionView);
          setVersionRestore(storePolicy.versionRestore);
          setAuditView(storePolicy.auditView);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.setAccessPolicy({
        versionView: versionView as 'viewer' | 'tech' | 'engineer' | 'admin',
        versionRestore: versionRestore as 'viewer' | 'tech' | 'engineer' | 'admin',
        auditView: auditView as 'viewer' | 'tech' | 'engineer' | 'admin',
      });
      // Refresh the cached capabilities so gated UI updates immediately
      // for the admin's own session if they changed their own access.
      await refreshPolicy();
      toast.success('Access policy updated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save access policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Section icon={<Lock className="w-5 h-5 text-emerald-400" />} title="Access Policy">
      <p className="text-xs text-slate-500 mb-4">
        Control which roles can reach compliance and forensic surfaces. The server enforces this on every request — these
        controls are the source of truth. Platform owners (L0) always have full access regardless of these settings.
      </p>

      <OptionGroup label="Version history — view & preview">
        <select
          value={versionView}
          onChange={(e) => setVersionView(e.target.value)}
          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-[11px] text-slate-600 mt-1.5">
          Who can open the CAD version history and preview prior saves. Default: everyone — it's their own work.
        </p>
      </OptionGroup>

      <OptionGroup label="Version restore (destructive — overwrites the live drawing)">
        <select
          value={versionRestore}
          onChange={(e) => setVersionRestore(e.target.value)}
          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-[11px] text-slate-600 mt-1.5">
          Who can roll a drawing back to a prior version. Default: admin only — restore overwrites current work.
        </p>
      </OptionGroup>

      <OptionGroup label="Audit log — page & per-entity activity">
        <select
          value={auditView}
          onChange={(e) => setAuditView(e.target.value)}
          className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-[11px] text-slate-600 mt-1.5">
          Who can open the audit log and per-entity activity views. Default: admin only — it's an oversight tool.
          Below this threshold the surface is hidden entirely, not degraded.
        </p>
      </OptionGroup>

      <div className="flex justify-end pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-500/20 border border-emerald-500/30 transition-all disabled:opacity-50 min-h-[44px]"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save access policy'}
        </button>
      </div>
    </Section>
  );
}
