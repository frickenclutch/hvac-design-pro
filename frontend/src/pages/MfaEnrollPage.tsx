import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, ShieldCheck, AlertCircle, ArrowRight, Copy, Check, KeyRound } from 'lucide-react';

type Stage = 'loading' | 'setup' | 'backup';

export default function MfaEnrollPage() {
  const {
    mfaEnrollToken, pendingEmail,
    enrollGrace, confirmEnrollGrace,
    authError, authLoading, clearError,
  } = useAuthStore();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('loading');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState<'secret' | 'backup' | null>(null);
  const startedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guard: no enroll token → back to sign-in (unless we've already minted a
  // session in the backup-codes stage, where the token is intentionally cleared).
  useEffect(() => {
    if (!mfaEnrollToken && stage !== 'backup') {
      navigate('/');
    }
  }, [mfaEnrollToken, stage, navigate]);

  // Kick off enrollment ONCE on mount (begins the grace credential).
  useEffect(() => {
    if (startedRef.current || !mfaEnrollToken) return;
    startedRef.current = true;
    (async () => {
      const res = await enrollGrace();
      if (res) {
        setSecret(res.secret);
        setOtpauthUri(res.otpauthUri);
        setStage('setup');
      }
      // On failure, authError is set + the store keeps mfaEnrollToken; the
      // guard effect leaves the page mounted so the user can read the error.
    })();
  }, [mfaEnrollToken, enrollGrace]);

  useEffect(() => { if (stage === 'setup') inputRef.current?.focus(); }, [stage]);

  const handleCodeChange = (value: string) => {
    setCode(value.replace(/\D/g, '').slice(0, 6));
    if (authError) clearError();
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    const codes = await confirmEnrollGrace(code);
    if (codes) {
      setBackupCodes(codes);
      setStage('backup');
    }
  };

  const copy = async (text: string, which: 'secret' | 'backup') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      {/* Hero Side */}
      <div className="md:w-1/2 p-6 md:p-12 flex flex-col justify-between relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
            <Compass className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
          </div>
          <span className="text-xl font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
        </div>

        <div className="mb-20">
          <h1 className="text-6xl font-extrabold text-white leading-tight tracking-tight mb-6">
            Secure your <br />
            <span className="text-slate-500">account</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-sm leading-relaxed">
            Your role requires multi-factor authentication. Set it up now to continue.
          </p>
        </div>

        <div className="space-y-4">
          <SecurityBadge />
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest pl-2">
            Required for administrators handling compliance-grade engineering data.
          </p>
        </div>
      </div>

      {/* Enroll Side */}
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-6 md:p-12 flex flex-col justify-center relative z-10 overflow-y-auto group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />

        <div className="max-w-md mx-auto w-full">
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="mb-8">
              <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-6">
                <ShieldCheck className="w-8 h-8 text-amber-400" />
              </div>
              <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">
                {stage === 'backup' ? 'Save Your Backup Codes' : 'Set Up Authenticator'}
              </h2>
              <p className="text-slate-500 font-medium">
                {stage === 'backup'
                  ? 'Store these somewhere safe. Each works once if you lose your device.'
                  : pendingEmail ? <>Securing <span className="text-slate-300">{pendingEmail}</span></> : 'Scan or enter the secret below.'}
              </p>
            </div>

            {authError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-in fade-in duration-200">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">{authError}</p>
                  <button onClick={clearError} className="text-xs text-red-400/60 hover:text-red-400 mt-1">Dismiss</button>
                </div>
              </div>
            )}

            {stage === 'loading' && (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {stage === 'setup' && (
              <>
                <div className="mb-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Manual entry secret</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-slate-800/80 border border-slate-700/60 rounded-xl py-3 px-4 text-emerald-300 font-mono text-sm break-all">{secret}</code>
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
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Or paste this URI into your app</label>
                    <code className="block bg-slate-800/40 border border-slate-700/40 rounded-xl py-2.5 px-3 text-slate-400 font-mono text-[11px] break-all">{otpauthUri}</code>
                  </div>
                </div>

                <form onSubmit={handleConfirm} className="space-y-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Enter the 6-digit code</label>
                    <input
                      ref={inputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={e => handleCodeChange(e.target.value)}
                      placeholder="000000"
                      className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-5 px-6 text-white text-center text-3xl font-mono tracking-[0.5em] placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading || code.length !== 6}
                    className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none min-h-[44px]"
                  >
                    {authLoading ? (
                      <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>Verify &amp; Continue <ArrowRight className="w-5 h-5" /></>
                    )}
                  </button>
                </form>
              </>
            )}

            {stage === 'backup' && (
              <>
                <div className="mb-6 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">One-time backup codes</span>
                  </div>
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
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 min-h-[44px]"
                >
                  Continue to Dashboard <ArrowRight className="w-5 h-5" />
                </button>
              </>
            )}

            {stage !== 'backup' && (
              <div className="mt-8 pt-8 border-t border-slate-800 text-center">
                <Link to="/login" className="text-sm text-slate-500 hover:text-slate-300 font-medium transition-colors">
                  Back to Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
