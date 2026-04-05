import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { SecureInput, SecurityBadge } from '../features/auth/components/SecurityComponents';
import { Compass, Mail, KeyRound } from 'lucide-react';

export default function AuthPage() {
  const login = useAuthStore(s => s.login);
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login('engineer@hvacpro.app');
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col md:flex-row overflow-hidden relative selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* Background Decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/5 blur-[120px]" />
      </div>

      {/* Hero Side - SpaceX aesthetic */}
      <div className="md:w-1/2 p-12 flex flex-col justify-between relative z-10">
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
      <div className="md:w-1/2 bg-slate-900 md:rounded-l-[4rem] border-l border-slate-800 shadow-2xl p-12 flex flex-col justify-center relative z-10 overflow-hidden group">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none group-focus-within:bg-emerald-500/10 transition-all duration-700" />
        
        <div className="max-w-md mx-auto w-full">
          <div className="mb-10">
            <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Professional Authentication</h2>
            <p className="text-slate-500 font-medium">Please enter your credentials to continue.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6 mb-10">
            <SecureInput 
              label="Engineering ID (Email)" 
              type="email" 
              placeholder="e.g. name@firm.app" 
              icon={<Mail className="w-5 h-5" />}
              required
            />
            <SecureInput 
              label="Access Code" 
              type="password" 
              placeholder="••••••••••••" 
              icon={<KeyRound className="w-5 h-5" />}
              required
            />
            
            <div className="flex items-center justify-between px-1">
              <label className="flex items-center gap-2 cursor-pointer group/check">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/50" />
                <span className="text-sm font-medium text-slate-500 group-hover/check:text-slate-300 transition-colors">Trust this secure machine</span>
              </label>
              <button type="button" className="text-sm font-bold text-emerald-400 hover:text-emerald-300 opacity-60 hover:opacity-100 transition-all">Forgot code?</button>
            </div>

            <button 
              type="submit" 
              className="w-full bg-slate-100 text-slate-950 py-4 rounded-2xl font-bold text-lg hover:bg-white hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all transform hover:-translate-y-1 active:scale-95"
            >
              Sign In to Command Center
            </button>
          </form>

          <div className="pt-10 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-center gap-4">
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
