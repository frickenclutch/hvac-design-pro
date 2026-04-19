import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, Mail, Lock, ArrowRight, ArrowLeft, Eye, EyeOff, AlertCircle, CheckCircle2, RotateCw, KeyRound } from 'lucide-react';

type Step = 'email' | 'code' | 'success';

export default function ForgotPasswordPage() {
  const { forgotPassword, resetPassword, authError, authLoading, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Focus code input when step changes
  useEffect(() => {
    if (step === 'code') {
      codeInputRef.current?.focus();
    }
  }, [step]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    clearError();
    const ok = await forgotPassword(email);
    if (ok) {
      setStep('code');
      setResendCooldown(60);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !newPassword || newPassword !== confirmPassword) return;
    clearError();
    const ok = await resetPassword(email, code, newPassword);
    if (ok) {
      setStep('success');
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    clearError();
    await forgotPassword(email);
    setResendCooldown(60);
  };

  const handleCodeChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (authError) clearError();
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
            Reset your <br />
            <span className="text-slate-500">password</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-sm leading-relaxed">
            {step === 'email' && "Enter your email and we'll send you a reset code."}
            {step === 'code' && 'Enter the code from your email along with your new password.'}
            {step === 'success' && 'Your password has been updated successfully.'}
          </p>
        </div>

        <div className="space-y-4">
          <SecurityBadge />
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest pl-2">
            Password reset codes expire after 15 minutes for your protection.
          </p>
        </div>
      </div>

      {/* Form Side */}
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-6 md:p-12 flex flex-col justify-center relative z-10 overflow-y-auto group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />

        <div className="max-w-md mx-auto w-full">
          {/* Step 1: Enter Email */}
          {step === 'email' && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="mb-10">
                <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
                  <KeyRound className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Forgot Password</h2>
                <p className="text-slate-500 font-medium">We'll email you a 6-digit reset code.</p>
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

              <form onSubmit={handleSendCode} className="space-y-5">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      autoComplete="email"
                      autoFocus
                      className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authLoading || !email}
                  className="w-full bg-slate-100 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {authLoading ? (
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>Send Reset Code <ArrowRight className="w-5 h-5" /></>
                  )}
                </button>
              </form>

              <div className="mt-8 pt-8 border-t border-slate-800 text-center">
                <Link to="/login" className="text-sm text-slate-500 hover:text-slate-300 font-medium transition-colors inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Back to Sign In
                </Link>
              </div>
            </div>
          )}

          {/* Step 2: Enter Code + New Password */}
          {step === 'code' && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="mb-10">
                <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
                  <KeyRound className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Enter Reset Code</h2>
                <p className="text-slate-500 font-medium">
                  Code sent to <span className="text-slate-300">{email}</span>
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

              <form onSubmit={handleResetPassword} className="space-y-5">
                {/* Code */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Reset Code</label>
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={e => handleCodeChange(e.target.value)}
                    placeholder="000000"
                    className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-4 px-6 text-white text-center text-2xl font-mono tracking-[0.4em] placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                  />
                </div>

                {/* New Password */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Create a new password"
                      autoComplete="new-password"
                      className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-4 pl-12 pr-12 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors" tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {newPassword && newPassword.length < 8 && (
                    <p className="text-xs text-amber-400 mt-1.5 ml-1">Password must be at least 8 characters</p>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-600" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      className={`w-full bg-slate-800/80 border rounded-2xl py-4 pl-12 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all ${confirmPassword && confirmPassword !== newPassword ? 'border-red-500/60' : 'border-slate-700/60'}`}
                    />
                  </div>
                  {confirmPassword && confirmPassword !== newPassword && (
                    <p className="text-xs text-red-400 mt-1.5 ml-1">Passwords do not match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={authLoading || code.length !== 6 || !newPassword || newPassword.length < 8 || newPassword !== confirmPassword}
                  className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {authLoading ? (
                    <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>Reset Password <ArrowRight className="w-5 h-5" /></>
                  )}
                </button>
              </form>

              {/* Resend */}
              <div className="mt-6 text-center">
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

              <div className="mt-6 pt-6 border-t border-slate-800 text-center">
                <button onClick={() => { setStep('email'); clearError(); }}
                  className="text-sm text-slate-500 hover:text-slate-300 font-medium transition-colors inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-4 h-4" /> Change Email
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 'success' && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500 text-center py-12">
              <div className="w-20 h-20 mx-auto mb-8 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
              <h2 className="text-4xl font-extrabold text-white mb-3 tracking-tight">Password Reset</h2>
              <p className="text-slate-400 text-lg leading-relaxed max-w-md mx-auto mb-10">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="bg-emerald-500 text-slate-950 px-12 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl inline-flex items-center gap-2"
              >
                Go to Sign In <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
