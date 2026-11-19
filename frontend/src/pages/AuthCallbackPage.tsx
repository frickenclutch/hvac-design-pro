import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { Compass, AlertCircle, ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';

export default function AuthCallbackPage() {
  const {
    ssoCallback, submitSsoLink, clearError,
    isAuthenticated, authError, authLoading,
    ssoLinkRequired, pendingEmail, mfaRequired, enrollmentRequired,
  } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // A ref, not state: the authorization code is single-use, so the exchange
  // must fire exactly once even when effects are double-invoked.
  const processed = useRef(false);
  const [linkCode, setLinkCode] = useState('');
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      useAuthStore.setState({
        authError: errorDescription || `Microsoft sign-in was cancelled or failed: ${error}`,
        authLoading: false,
      });
      return;
    }

    if (!code) {
      useAuthStore.setState({
        authError: 'No authorization code received from Microsoft.',
        authLoading: false,
      });
      return;
    }

    ssoCallback(code);
  }, [searchParams, ssoCallback]);

  // Where the sign-in goes next. A Microsoft sign-in can finish here, or hand
  // off to the same second-factor pages a password login uses.
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else if (mfaRequired) {
      navigate('/auth/mfa-challenge');
    } else if (enrollmentRequired) {
      navigate('/auth/mfa-enroll');
    }
  }, [isAuthenticated, mfaRequired, enrollmentRequired, navigate]);

  useEffect(() => {
    if (ssoLinkRequired) codeInputRef.current?.focus();
  }, [ssoLinkRequired]);

  const handleLinkCodeChange = (value: string) => {
    setLinkCode(value.replace(/\D/g, '').slice(0, 6));
    if (authError) clearError();
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (linkCode.length !== 6) return;
    await submitSsoLink(linkCode);
    // A wrong code keeps this step open — clear the field for the retry.
    if (useAuthStore.getState().ssoLinkRequired) {
      setLinkCode('');
      codeInputRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center relative selection:bg-emerald-500/30 selection:text-emerald-300">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 text-center max-w-md mx-auto px-6 py-10 w-full">
        <div className="flex items-center justify-center gap-2.5 mb-12">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
            <Compass className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
          </div>
          <span className="text-xl font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
        </div>

        {ssoLinkRequired ? (
          <div className="animate-in fade-in duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center">
              <MailCheck className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-3 tracking-tight">Confirm your email</h2>
            <p className="text-slate-400 mb-8 leading-relaxed">
              To connect this Microsoft account, enter the 6-digit code we sent to{' '}
              <span className="text-slate-200 font-semibold break-all">{pendingEmail}</span>.
            </p>

            {authError && (
              <div role="alert" className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 text-left animate-in fade-in duration-200">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300 font-medium">{authError}</p>
              </div>
            )}

            <form onSubmit={handleLinkSubmit} className="space-y-5 text-left">
              <div>
                <label htmlFor="sso-link-code" className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">
                  Verification Code
                </label>
                <input
                  id="sso-link-code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={linkCode}
                  onChange={e => handleLinkCodeChange(e.target.value)}
                  placeholder="000000"
                  className="w-full bg-slate-800/80 border border-slate-700/60 rounded-2xl py-5 px-6 text-white text-center font-mono text-3xl tracking-[0.5em] placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/30 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading || linkCode.length !== 6}
                className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none min-h-[44px]"
              >
                {authLoading ? (
                  <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>Confirm and sign in <ArrowRight className="w-5 h-5" /></>
                )}
              </button>
            </form>

            <p className="mt-6 text-xs text-slate-500 leading-relaxed">
              The code expires in 10 minutes. Didn&apos;t get it? Check spam, or go back and sign in with Microsoft again to send a new one.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-400 hover:text-white transition-colors min-h-[44px] px-4"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Sign In
            </Link>
          </div>
        ) : authError ? (
          <div className="animate-in fade-in duration-300">
            <div className="w-16 h-16 mx-auto mb-6 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-3 tracking-tight">Sign-in Failed</h2>
            <p className="text-slate-400 mb-8 leading-relaxed">{authError}</p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 bg-slate-100 text-slate-950 px-8 py-3.5 rounded-2xl font-bold hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl"
            >
              <ArrowLeft className="w-5 h-5" /> Back to Sign In
            </Link>
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
            <div className="w-12 h-12 mx-auto mb-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight">Signing you in</h2>
            <p className="text-slate-500 font-medium">Completing Microsoft authentication...</p>
          </div>
        )}
      </div>
    </div>
  );
}
