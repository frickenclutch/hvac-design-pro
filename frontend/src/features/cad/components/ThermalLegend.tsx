/**
 * ThermalLegend — Floating overlay that shows when thermal overlay is enabled.
 * Displays the R-value color legend + live building summary stats.
 */

import { Flame, Snowflake, Thermometer, Zap } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { useThermalAnalysis, GRADE_COLORS } from '../hooks/useThermalAnalysis';

const LEGEND_ITEMS = [
  { label: 'R \u2265 21', grade: 'Excellent', color: GRADE_COLORS.excellent },
  { label: 'R 13\u201320', grade: 'Good', color: GRADE_COLORS.good },
  { label: 'R 7\u201312', grade: 'Fair', color: GRADE_COLORS.fair },
  { label: 'R < 7', grade: 'Poor', color: GRADE_COLORS.poor },
];

function fmtBtu(btu: number): string {
  if (btu >= 100000) return `${(btu / 1000).toFixed(0)}k`;
  if (btu >= 10000) return `${(btu / 1000).toFixed(1)}k`;
  return btu.toLocaleString();
}

export default function ThermalLegend() {
  const thermalOverlayEnabled = useCadStore(s => s.thermalOverlayEnabled);
  const analysis = useThermalAnalysis();

  if (!thermalOverlayEnabled) return null;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="glass-panel rounded-2xl border border-amber-500/20 bg-slate-900/90 backdrop-blur-xl shadow-[0_0_40px_rgba(245,158,11,0.1)] px-5 py-3">
        <div className="flex items-center gap-6">

          {/* Title */}
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-amber-400" />
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Thermal Overlay</span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3">
            {LEGEND_ITEMS.map(item => (
              <div key={item.grade} className="flex items-center gap-1.5">
                <div
                  className="w-4 h-2 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[9px] text-slate-400 font-mono">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-700/60" />

          {/* Live stats */}
          {analysis.hasRooms ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" />
                <span className="text-[10px] text-orange-300 font-mono font-bold">{fmtBtu(analysis.totalHeatingBtu)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Snowflake className="w-3 h-3 text-sky-400" />
                <span className="text-[10px] text-sky-300 font-mono font-bold">{fmtBtu(analysis.totalCoolingBtu)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-300 font-mono font-bold">{analysis.recommendedTons.toFixed(1)}T</span>
              </div>
            </div>
          ) : (
            <span className="text-[9px] text-slate-500 italic">Detect rooms for load calc</span>
          )}
        </div>
      </div>
    </div>
  );
}
