import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, ShieldCheck, AlertCircle, ArrowRight, RotateCw } from 'lucide-react';

export default function VerifyEmailPage() {
  const { pendingEmail, pendingVerification, verifyEmail, resendVerification, authError, authLoading, clearError, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSent, setResendSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Redirect if no pending verification or already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
      return;
    }
    if (!pendingVerification || !pendingEmail) {
      navigate('/login');
    }
  }, [isAuthenticated, pendingVerification, pendingEmail, navigate]);

  // Start initial cooldown (code was just sent during registration)
  useEffect(() => {
    setResendCooldown(60);
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmail || code.length !== 6) return;
    await verifyEmail(pendingEmail, code);
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !pendingEmail) return;
    clearError();
    await resendVerification(pendingEmail);
    setResendCooldown(60);
    setResendSent(true);
  };

  const handleCodeChange = (value: string) => {
    // Only allow digits, max 6
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (clearError && authError) clearError();
  };

  if (!pendingEmail) return null;

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
            Check your <br />
            <span className="text-slate-500">inbox</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-sm leading-relaxed">
            We sent a 6-digit verification code to your email address.
          </p>
        </div>

        <div className="space-y-4">
          <SecurityBadge />
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest pl-2">
            Email verification protects your account and ensures data integrity.
          </p>
        </div>
      </div>

      {/* Verification Side */}
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-6 md:p-12 flex flex-col justify-center relative z-10 overflow-y-auto group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />

        <div className="max-w-md mx-auto w-full">
          <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="mb-10">
              <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Verify Your Email</h2>
              <p className="text-slate-500 font-medium">
                Enter the code sent to <span className="text-slate-300">{pendingEmail}</span>
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

            {/* Resend confirmation */}
            {resendSent && !authError && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 animate-in fade-in duration-200">
                <p className="text-sm text-emerald-300 font-medium">A new code has been sent to your email.</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Code Input */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Verification Code</label>
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
                className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {authLoading ? (
                  <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>Verify Email <ArrowRight className="w-5 h-5" /></>
                )}
              </button>
            </form>

            {/* Resend */}
            <div className="mt-8 text-center">
              {resendCooldown > 0 ? (
                <p className="text-sm text-slate-600 font-medium">
                  Resend code in <span className="text-slate-400 font-bold">{resendCooldown}s</span>
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  className="text-sm text-emerald-400 hover:text-emerald-300 font-bold transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCw className="w-4 h-4" /> Resend Code
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
