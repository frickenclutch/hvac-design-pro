import React from 'react';
import { MousePointer2, Hand, SquarePen, LayoutGrid, DoorOpen, Wind, Ruler, Type, ScanLine } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import type { ToolType } from '../store/useCadStore';

export default function Toolbox() {
  const { activeTool, setActiveTool } = useCadStore();

  return (
    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10">
      <div className="glass-panel rounded-2xl flex flex-col items-center py-4 gap-2 shadow-[0_0_40px_rgba(0,0,0,0.8)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/60 transition-all duration-300">

        <ToolButton
          id="select"
          icon={<MousePointer2 className="w-5 h-5" />}
          label="Select (V)"
          active={activeTool === 'select'}
          onClick={() => setActiveTool('select')}
        />

        <ToolButton
          id="pan"
          icon={<Hand className="w-5 h-5" />}
          label="Pan (H)"
          active={activeTool === 'pan'}
          onClick={() => setActiveTool('pan')}
        />

        <div className="w-8 h-px bg-slate-700/60 my-2 rounded-full" />

        <ToolButton
          id="draw_wall"
          icon={<SquarePen className="w-5 h-5" />}
          label="Draw Wall (W)"
          active={activeTool === 'draw_wall'}
          onClick={() => setActiveTool('draw_wall')}
        />

        <ToolButton
          id="place_window"
          icon={<LayoutGrid className="w-5 h-5" />}
          label="Add Window"
          active={activeTool === 'place_window'}
          onClick={() => setActiveTool('place_window')}
        />

        <ToolButton
          id="place_door"
          icon={<DoorOpen className="w-5 h-5" />}
          label="Add Door"
          active={activeTool === 'place_door'}
          onClick={() => setActiveTool('place_door')}
        />

        <div className="w-8 h-px bg-slate-700/60 my-2 rounded-full" />

        <ToolButton
          id="place_hvac"
          icon={<Wind className="w-5 h-5" />}
          label="HVAC Unit"
          active={activeTool === 'place_hvac'}
          onClick={() => setActiveTool('place_hvac')}
          primary
        />

        <div className="w-8 h-px bg-slate-700/60 my-2 rounded-full" />

        <ToolButton
          id="add_dimension"
          icon={<Ruler className="w-5 h-5" />}
          label="Dimension"
          active={activeTool === 'add_dimension'}
          onClick={() => setActiveTool('add_dimension')}
        />

        <ToolButton
          id="add_label"
          icon={<Type className="w-5 h-5" />}
          label="Label"
          active={activeTool === 'add_label'}
          onClick={() => setActiveTool('add_label')}
        />

        <ToolButton
          id="room_detect"
          icon={<ScanLine className="w-5 h-5" />}
          label="Detect Rooms"
          active={activeTool === 'room_detect'}
          onClick={() => setActiveTool('room_detect')}
        />

      </div>
    </div>
  );
}

interface ToolButtonProps {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  primary?: boolean;
}

function ToolButton({ icon, label, active, onClick, primary }: ToolButtonProps) {
  const baseClass = "p-3 mx-2 rounded-xl transition-all duration-300 group relative";
  
  let stateClass = "text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent";
  
  if (active) {
    if (primary) {
      stateClass = "text-emerald-50 bg-emerald-500/20 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)]";
    } else {
      stateClass = "text-sky-50 bg-sky-500/20 border border-sky-500/50 shadow-[0_0_20px_rgba(14,165,233,0.3)]";
    }
  } else if (primary) {
    stateClass = "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-transparent";
  }

  return (
    <div className="relative group">
      <button 
        onClick={onClick}
        className={`${baseClass} ${stateClass}`}
        aria-label={label}
      >
        {icon}
      </button>
      
      {/* Tooltip */}
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 backdrop-blur-md shadow-xl">
        {label}
        {/* Tooltip pointer */}
        <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45" />
      </div>
    </div>
  );
}
