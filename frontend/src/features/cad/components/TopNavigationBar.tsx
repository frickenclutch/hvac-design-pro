import React from 'react';
import { ArrowLeft, Save, Undo2, Redo2, Download, Zap } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useCadStore } from '../store/useCadStore';
import { useAuthStore } from '../../auth/store/useAuthStore';
import { generatePdfPlot } from '../utils/pdfGenerator';

export default function TopNavigationBar() {
  const { id } = useParams();
  const { canvas, undo, redo, isDirty, isSaving, lastSavedAt, saveError } = useCadStore();
  const { user, organisation } = useAuthStore();

  const saveStatusText = saveError ? 'Save error' : isSaving ? 'Saving...' : isDirty ? 'Unsaved' : lastSavedAt ? 'Saved' : 'Draft';
  const saveStatusColor = saveError ? 'text-red-400 border-red-500/20 bg-red-500/10' : isSaving ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : isDirty ? 'text-slate-400 border-slate-500/20 bg-slate-500/10' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';

  const handleExport = () => {
    if (!canvas) {
      console.warn('Canvas not found for PDF export.');
      return;
    }

    const metadata = {
      projectName: 'BUILDING_SCHEMA_1029_A',
      engineerName: user ? `${user.firstName} ${user.lastName}` : 'UNAUTHORIZED_PRO',
      organisationName: organisation?.name || 'GENERIC_FIRM',
      date: new Date().toLocaleDateString(),
      region: organisation?.regionCode || 'NA_ASHRAE',
      projectId: id || '1029-A',
    };

    generatePdfPlot(canvas, metadata);
  };

  return (
    <div className="absolute top-0 left-0 right-0 h-16 z-20 pointer-events-none">
      <div className="h-full px-6 flex items-center justify-between pointer-events-auto bg-gradient-to-b from-slate-950/90 to-transparent">
        
        {/* Left Side */}
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800 transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-100 tracking-wide drop-shadow-md">Building Schema</h2>
              <span className={`${saveStatusColor} text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded border`}>{saveStatusText}</span>
            </div>
            <span className="text-xs text-slate-500 font-mono">ID: {id || '1029-A'}</span>
          </div>
        </div>

        {/* Center - Global Actions */}
        <div className="hidden md:flex items-center gap-2 glass-panel rounded-full px-4 py-2 border border-slate-700/50 shadow-[0_5px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <ActionButton icon={<Undo2 className="w-4 h-4" />} tooltip="Undo (Ctrl+Z)" onClick={undo} />
          <ActionButton icon={<Redo2 className="w-4 h-4" />} tooltip="Redo (Ctrl+Y)" onClick={redo} />
          <div className="w-px h-4 bg-slate-700/60 mx-2" />
          <ActionButton icon={<Zap className="w-4 h-4" />} tooltip="Auto-Calculate Load" highlight />
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
           <button 
             onClick={handleExport}
             className="flex items-center gap-2 bg-slate-900/80 text-slate-300 px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-white hover:bg-slate-800 transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] border border-slate-700/50 backdrop-blur-md"
           >
             <Download className="w-4 h-4" /> Export PDF
           </button>
           <button className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all shadow-[0_4px_15px_rgba(0,0,0,0.4)] border border-emerald-500/30 backdrop-blur-md">
             <Save className="w-4 h-4" /> Save
           </button>
        </div>

      </div>
    </div>
  );
}

function ActionButton({ icon, tooltip, highlight, onClick }: { icon: React.ReactNode; tooltip: string; highlight?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`p-2 rounded-full transition-colors group relative ${highlight ? 'text-emerald-400 hover:bg-emerald-500/20' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`} aria-label={tooltip}>
      {icon}
      {/* Tooltip */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-slate-800 text-slate-200 text-[10px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-slate-700">
        {tooltip}
      </div>
    </button>
  );
}
