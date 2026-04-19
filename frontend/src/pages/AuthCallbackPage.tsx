import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { Compass, AlertCircle, ArrowLeft } from 'lucide-react';

export default function AuthCallbackPage() {
  const { ssoCallback, isAuthenticated, authError } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [processed, setProcessed] = useState(false);

  useEffect(() => {
    if (processed) return;
    setProcessed(true);

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
  }, [searchParams, ssoCallback, processed]);

  // Redirect to dashboard on success
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center relative selection:bg-emerald-500/30 selection:text-emerald-300">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 text-center max-w-md mx-auto px-6">
        <div className="flex items-center justify-center gap-2.5 mb-12">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
            <Compass className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
          </div>
          <span className="text-xl font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
        </div>

        {authError ? (
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
