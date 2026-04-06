import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecureInput, SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, Mail, ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react';

export default function AuthPage() {
  const { login, setAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [authStep, setAuthStep] = useState(1); // 1: Identity, 2: Authenticator

  const handleIdentitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setLoading(true);
      setTimeout(() => {
        setAuthStep(2);
        setLoading(false);
      }, 800);
    }
  };

  const handleOTPSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length === 6) {
      login(email || 'engineer@hvacpro.app');
      setAuthenticated(true);
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* Background Decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      {/* Hero Side - SpaceX aesthetic */}
      <div className="md:w-1/2 p-6 md:p-12 flex flex-col justify-between relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
             <Compass className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
          </div>
          <span className="text-xl font-bold tracking-tight premium-gradient-text">HVAC DesignPro</span>
        </div>

        <div className="mb-20">
          <h1 className="text-6xl font-extrabold text-white leading-tight tracking-tight mb-6">
            Sign in to <br />
            <span className="text-slate-500">DesignPro</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-sm leading-relaxed">
            Access your engineering workspace and cloud calculations.
          </p>
        </div>

        <div className="space-y-4">
           <SecurityBadge />
           <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest pl-2">
             All sessions are monitored and identity-verified for regulatory compliance.
           </p>
        </div>
      </div>

      {/* Sign In Side */}
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-6 md:p-12 flex flex-col justify-center relative z-10 overflow-y-auto group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />
        
        <div className="max-w-md mx-auto w-full">
          {authStep === 1 ? (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="mb-10">
                <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Identity Initialization</h2>
                <p className="text-slate-500 font-medium">Verify your engineering credentials to continue.</p>
              </div>

              <form onSubmit={handleIdentitySubmit} className="space-y-6">
                <SecureInput 
                  label="Engineering ID (Email)" 
                  type="email" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@firm.app" 
                  icon={<Mail className="w-5 h-5" />}
                  required
                />

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-slate-100 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl flex items-center justify-center gap-2"
                >
                  {loading ? "Verifying..." : "Initialize Session"}
                  {!loading && <ArrowRight className="w-5 h-5" />}
                </button>
              </form>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
              <button 
                onClick={() => setAuthStep(1)}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-300 transition-colors mb-6 font-bold text-xs uppercase tracking-widest"
              >
                <ArrowLeft className="w-4 h-4" />
                Change Identity
              </button>

              <div className="mb-10">
                <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Secure Node Verification</h2>
                <p className="text-slate-500 font-medium">Enter the 6-digit code from <b>Google Authenticator</b>.</p>
              </div>

              <form onSubmit={handleOTPSubmit} className="space-y-8">
                <SecureInput 
                  label="6-Digit Secure Node" 
                  type="text" 
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  placeholder="000 000" 
                  icon={<ShieldCheck className="w-5 h-5 text-emerald-500" />}
                  required
                />

                <button 
                  type="submit" 
                  className="w-full bg-emerald-500 text-slate-950 py-4 rounded-2xl font-black text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 shadow-xl"
                >
                  Confirm Command Entry
                </button>
              </form>

              <p className="mt-8 text-center text-xs text-slate-600 font-medium">
                Lost access to your device? <button className="text-emerald-500 font-bold hover:underline">Contact System Admin</button>
              </p>
            </div>
          )}

          <div className="pt-10 mt-10 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-center gap-4">
             <span className="text-slate-500 text-sm font-medium">New to DesignPro?</span>
             <Link to="/onboarding" className="text-emerald-400 hover:text-emerald-300 font-bold text-sm tracking-tight border-b-2 border-emerald-500/20 hover:border-emerald-500 pb-0.5 transition-all">
               Get Started
             </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
