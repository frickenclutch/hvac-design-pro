import React from 'react';
import { Shield, Lock } from 'lucide-react';

interface SecureInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: React.ReactNode;
}

export function SecureInput({ label, icon, ...props }: SecureInputProps) {
  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-2 px-1">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest leading-none">{label}</label>
      </div>
      <div className="relative group">
        {/* Subtle accent glow on focus */}
        <div className="absolute inset-0 bg-emerald-500/0 group-focus-within:bg-emerald-500/[0.03] blur-2xl transition-all duration-500 rounded-2xl pointer-events-none" />
        
        <div className="relative flex items-center bg-slate-900/60 border border-slate-800 group-focus-within:border-slate-600 rounded-2xl transition-all shadow-sm overflow-hidden">
          {icon && (
            <div className="pl-4 text-slate-600 group-focus-within:text-slate-400 transition-colors">
              {icon}
            </div>
          )}
          <input 
            {...props} 
            className="w-full bg-transparent border-none text-white px-4 py-4 text-base focus:outline-none placeholder:text-slate-700 font-medium"
          />
          <div className="pr-4 text-slate-800 group-focus-within:text-slate-600 transition-colors opacity-0 group-focus-within:opacity-100 transition-opacity">
            <Lock className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SecurityBadge() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/40 backdrop-blur-sm">
      <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-400 border border-slate-700/50 shadow-sm">
        <Shield className="w-5 h-5 opacity-40" />
      </div>
      <div>
        <p className="text-xs font-bold text-white uppercase tracking-wider mb-0.5">Secure Session</p>
        <p className="text-[10px] text-slate-500 font-medium leading-none tracking-tight">Identity verified and encrypted</p>
      </div>
      <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500/40 animate-pulse" />
    </div>
  );
}

export function SecurityPanel({ children, title, description }: { children: React.ReactNode, title: string, description?: string }) {
  return (
    <div className="glass-panel p-8 rounded-3xl border border-slate-800/50 relative overflow-hidden group">
      <div className="mb-0 relative z-10">
        <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">{title}</h2>
        {description && <p className="text-slate-400 mb-8 text-lg leading-relaxed">{description}</p>}
        
        <div className="space-y-6">
          {children}
        </div>
      </div>
    </div>
  );
}

import { Fingerprint } from 'lucide-react';

export function PasskeyButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center justify-center gap-4 py-4 px-6 rounded-2xl bg-white text-slate-950 font-bold hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all transform hover:-translate-y-1 active:scale-95 disabled:opacity-50"
    >
      <Fingerprint className="w-5 h-5 text-slate-900" />
      <span>{loading ? "Initializing..." : "Continue with Passkey"}</span>
    </button>
  );
}
