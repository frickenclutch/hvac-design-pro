import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, ShieldCheck, AlertCircle, ArrowRight, KeyRound, Mail } from 'lucide-react';

type Method = 'totp' | 'backup' | 'email';

export default function MfaChallengePage() {
  const {
    mfaChallengeToken, mfaMethods, pendingEmail,
    submitMfaChallenge, sendMfaEmailCode,
    authError, authLoading, clearError, isAuthenticated,
  } = useAuthStore();
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('totp');
  const [code, setCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Guard: no live challenge → back to sign-in. On success → dashboard.
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
      return;
    }
    if (!mfaChallengeToken) {
      navigate('/');
    }
  }, [isAuthenticated, mfaChallengeToken, navigate]);

  useEffect(() => { inputRef.current?.focus(); }, [method]);

  const canEmail = mfaMethods.includes('email');
  const canBackup = mfaMethods.includes('backup');
  // TOTP / email are 6-digit numeric; backup codes are alphanumeric "ABCDE-FGHIJ".
  const isNumeric = method !== 'backup';

  const handleCodeChange = (value: string) => {
    if (isNumeric) {
      setCode(value.replace(/\D/g, '').slice(0, 6));
    } else {
      setCode(value.toUpperCase().slice(0, 11));
    }
    if (authError) clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    await submitMfaChallenge(code, method);
    // Navigation happens via the isAuthenticated effect on success.
  };

  const handleSwitch = (m: Method) => {
    setMethod(m);
    setCode('');
    if (authError) clearError();
  };

  const handleSendEmail = async () => {
    const ok = await sendMfaEmailCode();
    if (ok) {
      setEmailSent(true);
      handleSwitch('email');
    }
  };

  if (!mfaChallengeToken) return null;

  const submitDisabled = authLoading || (isNumeric ? code.length !== 6 : code.length < 5);

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
            One more <br />
            <span className="text-slate-500">step</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-sm leading-relaxed">
            Enter the code from your authenticator app to finish signing in.
          </p>
        </div>

        <div className="space-y-4">
          <SecurityBadge />
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest pl-2">
            Multi-factor authentication protects your account from unauthorized access.
          </p>
        </div>
      </div>

      {/* Challenge Side */}
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-6 md:p-12 flex flex-col justify-center relative z-10 overflow-y-auto group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />

        <div className="max-w-md mx-auto w-full">
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="mb-10">
              <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Two-Factor Verification</h2>
              <p className="text-slate-500 font-medium">
                {method === 'totp' && 'Enter the 6-digit code from your authenticator app.'}
                {method === 'email' && (
                  <>Enter the 6-digit code we sent to <span className="text-slate-300">{pendingEmail}</span>.</>
                )}
                {method === 'backup' && 'Enter one of your one-time backup codes.'}
              </p>
            </div>

            {/* Error Banner */}
            {authError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 animate-in fade-in duration-200">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">{authError}</p>
                  <button onClick={clearError} className="text-xs text-red-400/60 hover:text-red-400 mt-1">Dismiss</button>
                </div>
              </div>
            )}

            {emailSent && method === 'email' && !authError && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 animate-in fade-in duration-200">
                <p className="text-sm text-emerald-300 font-medium">A sign-in code has been sent to your email.</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">
                  {method === 'backup' ? 'Backup Code' : 'Verification Code'}
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode={isNumeric ? 'numeric' : 'text'}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={e => handleCodeChange(e.target.value)}
                  placeholder={method === 'backup' ? 'ABCDE-FGHIJ' : '000000'}
                  className={`w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-5 px-6 text-white text-center font-mono placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all ${isNumeric ? 'text-3xl tracking-[0.5em]' : 'text-2xl tracking-[0.2em]'}`}
                />
              </div>

              <button
                type="submit"
                disabled={submitDisabled}
                className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none min-h-[44px]"
              >
                {authLoading ? (
                  <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>Verify <ArrowRight className="w-5 h-5" /></>
                )}
              </button>
            </form>

            {/* Method switches */}
            <div className="mt-8 space-y-3">
              {method !== 'totp' && (
                <button
                  onClick={() => handleSwitch('totp')}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-700/60 bg-slate-800/50 text-slate-300 font-bold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all min-h-[44px]"
                >
                  <ShieldCheck className="w-4 h-4" /> Use authenticator app
                </button>
              )}
              {canBackup && method !== 'backup' && (
                <button
                  onClick={() => handleSwitch('backup')}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-700/60 bg-slate-800/50 text-slate-300 font-bold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all min-h-[44px]"
                >
                  <KeyRound className="w-4 h-4" /> Use a backup code
                </button>
              )}
              {canEmail && method !== 'email' && (
                <button
                  onClick={handleSendEmail}
                  disabled={authLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-700/60 bg-slate-800/50 text-slate-300 font-bold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all disabled:opacity-50 min-h-[44px]"
                >
                  <Mail className="w-4 h-4" /> Email me a code
                </button>
              )}
            </div>

            <div className="mt-8 pt-8 border-t border-slate-800 text-center">
              <Link to="/login" className="text-sm text-slate-500 hover:text-slate-300 font-medium transition-colors">
                Back to Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
