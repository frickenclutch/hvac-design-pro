/**
 * BuildingScience — Deep interop panel between CAD canvas, 3D Viewer, and Manual J.
 *
 * Docked left panel (like AssetLibrary) that shows:
 * - Live thermal analysis from CAD geometry
 * - Per-wall R-value ratings with color grading
 * - Per-window U-Factor / SHGC performance
 * - Per-room heating/cooling loads from Manual J engine
 * - Whole-building summary with tonnage recommendation
 * - Thermal overlay toggle for both 2D and 3D views
 * - Direct links to edit properties (click wall/window → select on canvas)
 */

import { useState, useCallback, useRef } from 'react';
import {
  X, Thermometer, Flame, Snowflake, Wind, Eye, EyeOff,
  ChevronDown, ChevronUp, GripVertical, AlertTriangle,
  ArrowRight, Zap, Layers, Sun, Shield, BarChart3,
} from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import {
  useThermalAnalysis,
  GRADE_COLORS,
  GRADE_LABELS,
  type ThermalGrade,
} from '../hooks/useThermalAnalysis';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  thermalOverlayEnabled: boolean;
  onToggleThermalOverlay: () => void;
}

// ── Grade Badge ──────────────────────────────────────────────────────────────

function GradeBadge({ grade, size = 'sm' }: { grade: ThermalGrade; size?: 'sm' | 'md' }) {
  const color = GRADE_COLORS[grade];
  const px = size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]';
  return (
    <span
      className={`${px} rounded font-bold uppercase tracking-wider`}
      style={{ color, backgroundColor: `${color}20`, border: `1px solid ${color}40` }}
    >
      {GRADE_LABELS[grade]}
    </span>
  );
}

// ── Collapsible Section ──────────────────────────────────────────────────────

function Section({
  title, icon, count, defaultOpen = true, children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-800/60">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        {icon}
        <span className="flex-1 text-xs font-bold text-slate-300 uppercase tracking-wider">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] text-slate-500 font-mono">{count}</span>
        )}
        {open ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, unit, icon, color = 'text-slate-300',
}: {
  label: string;
  value: string | number;
  unit: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold ${color}`}>{value}</span>
        <span className="text-[10px] text-slate-500">{unit}</span>
      </div>
    </div>
  );
}

// ── Format helpers ───────────────────────────────────────────────────────────

function fmtBtu(btu: number): string {
  if (btu >= 100000) return `${(btu / 1000).toFixed(0)}k`;
  if (btu >= 10000) return `${(btu / 1000).toFixed(1)}k`;
  return btu.toLocaleString();
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function BuildingScience({
  isOpen,
  onClose,
  thermalOverlayEnabled,
  onToggleThermalOverlay,
}: Props) {
  const analysis = useThermalAnalysis();
  const [panelWidth, setPanelWidth] = useState(400);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // ── Resize handling ────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      setPanelWidth(Math.max(320, Math.min(900, resizeRef.current.startW + delta)));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // ── Click to select entity on canvas ───────────────────────────────────
  const selectOnCanvas = useCallback((fabricPrefix: string, entityId: string) => {
    const canvas = useCadStore.getState().canvas;
    if (!canvas) return;
    const target = canvas.getObjects().find((obj: any) => {
      const n = obj.name as string | undefined;
      return n === `${fabricPrefix}${entityId}` || n?.endsWith(entityId);
    });
    if (target) {
      canvas.setActiveObject(target);
      useCadStore.getState().setSelectedObject(target as any);
      canvas.requestRenderAll();
    }
  }, []);

  if (!isOpen) return null;

  const { walls, windows, rooms, wholeHouse, hasRooms, totalHeatingBtu, totalCoolingBtu, recommendedTons } = analysis;

  // ── Aggregate stats ────────────────────────────────────────────────────
  const avgWallR = walls.length > 0
    ? (walls.reduce((s, w) => s + w.rValue, 0) / walls.length).toFixed(1)
    : '—';
  const avgWindowU = windows.length > 0
    ? (windows.reduce((s, w) => s + w.uFactor, 0) / windows.length).toFixed(2)
    : '—';
  const totalWallLength = walls.reduce((s, w) => s + w.lengthFt, 0);
  const totalWindowArea = windows.reduce((s, w) => s + w.areaSqFt, 0);
  const poorWalls = walls.filter(w => w.grade === 'poor' || w.grade === 'fair').length;
  const poorWindows = windows.filter(w => w.grade === 'poor' || w.grade === 'fair').length;

  return (
    <div
      className="fixed top-0 left-[72px] bottom-0 z-[95] flex"
      style={{ width: panelWidth }}
    >
      {/* Panel Body */}
      <div className="flex-1 flex flex-col bg-slate-900/95 backdrop-blur-xl border-r border-slate-700/50 shadow-[4px_0_30px_rgba(0,0,0,0.5)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <Thermometer className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Building Science</h2>
              <p className="text-[10px] text-slate-500">Thermal Analysis · Manual J Interop</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleThermalOverlay}
              className={`p-2 rounded-lg transition-colors ${thermalOverlayEnabled ? 'bg-amber-500/15 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
              title={thermalOverlayEnabled ? 'Hide thermal overlay' : 'Show thermal overlay'}
            >
              {thermalOverlayEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800/50">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ═══ Building Summary ═══ */}
          <Section
            title="Building Summary"
            icon={<BarChart3 className="w-4 h-4 text-emerald-400" />}
          >
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Heating Load"
                value={fmtBtu(totalHeatingBtu)}
                unit="BTU/hr"
                icon={<Flame className="w-3 h-3 text-orange-400" />}
                color="text-orange-400"
              />
              <MetricCard
                label="Cooling Load"
                value={fmtBtu(totalCoolingBtu)}
                unit="BTU/hr"
                icon={<Snowflake className="w-3 h-3 text-sky-400" />}
                color="text-sky-400"
              />
              <MetricCard
                label="Equipment Size"
                value={recommendedTons > 0 ? recommendedTons.toFixed(1) : '—'}
                unit="tons"
                icon={<Zap className="w-3 h-3 text-amber-400" />}
                color="text-amber-400"
              />
              <MetricCard
                label="SHR"
                value={wholeHouse ? (wholeHouse.sensibleHeatRatio * 100).toFixed(0) : '—'}
                unit="%"
                icon={<Wind className="w-3 h-3 text-purple-400" />}
                color="text-purple-400"
              />
            </div>

            {!hasRooms && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-[10px] text-amber-300 leading-relaxed">
                  <strong>No rooms detected.</strong> Use the Room Detect tool (R) to identify rooms from your wall layout. Load calculations require enclosed rooms.
                </p>
              </div>
            )}

            {/* Design conditions summary */}
            <div className="mt-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold mb-2">Design Conditions</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Heating outdoor</span>
                  <span className="text-orange-400 font-mono">{analysis.conditions.outdoorHeatingTemp}°F</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cooling outdoor</span>
                  <span className="text-sky-400 font-mono">{analysis.conditions.outdoorCoolingTemp}°F</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Latitude</span>
                  <span className="text-slate-300 font-mono">{analysis.conditions.latitude}°</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Elevation</span>
                  <span className="text-slate-300 font-mono">{analysis.conditions.elevation} ft</span>
                </div>
              </div>
            </div>
          </Section>

          {/* ═══ Room Loads ═══ */}
          <Section
            title="Room Loads"
            icon={<Layers className="w-4 h-4 text-sky-400" />}
            count={rooms.length}
            defaultOpen={hasRooms}
          >
            {rooms.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic">Detect rooms to see per-room loads.</p>
            ) : (
              <div className="space-y-2">
                {rooms.map(room => (
                  <div
                    key={room.cadRoomId}
                    className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50 transition-colors cursor-pointer"
                    onClick={() => selectOnCanvas('room-', room.cadRoomId)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{room.roomName}</span>
                        <GradeBadge grade={room.grade} />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{room.areaSqFt.toFixed(0)} ft²</span>
                    </div>

                    {room.result && (
                      <>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <Flame className="w-3 h-3 text-orange-400" />
                            <span className="text-[10px] text-orange-300 font-mono">{fmtBtu(room.result.heatingBtu)}</span>
                            <span className="text-[9px] text-slate-600">BTU/hr</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Snowflake className="w-3 h-3 text-sky-400" />
                            <span className="text-[10px] text-sky-300 font-mono">{fmtBtu(room.result.coolingBtuTotal)}</span>
                            <span className="text-[9px] text-slate-600">BTU/hr</span>
                          </div>
                        </div>

                        {/* Intensity bar */}
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-500 w-16 shrink-0">Intensity</span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, (room.heatingIntensity / 50) * 100)}%`,
                                backgroundColor: GRADE_COLORS[room.grade],
                              }}
                            />
                          </div>
                          <span className="text-[9px] font-mono" style={{ color: GRADE_COLORS[room.grade] }}>
                            {room.heatingIntensity} BTU/ft²
                          </span>
                        </div>

                        {/* Breakdown mini-chart */}
                        <div className="mt-2 grid grid-cols-5 gap-1">
                          {[
                            { label: 'Wall', val: room.result.breakdown.wallLoss, color: '#22c55e' },
                            { label: 'Win', val: room.result.breakdown.windowLoss, color: '#38bdf8' },
                            { label: 'Ceil', val: room.result.breakdown.ceilingLoss, color: '#a78bfa' },
                            { label: 'Floor', val: room.result.breakdown.floorLoss, color: '#f59e0b' },
                            { label: 'Infil', val: room.result.breakdown.infiltrationSensible, color: '#64748b' },
                          ].map(item => {
                            const total = room.result!.heatingBtu || 1;
                            const pct = Math.round((item.val / total) * 100);
                            return (
                              <div key={item.label} className="text-center">
                                <div className="h-8 flex items-end justify-center mb-0.5">
                                  <div
                                    className="w-4 rounded-t"
                                    style={{
                                      height: `${Math.max(2, (pct / 100) * 32)}px`,
                                      backgroundColor: item.color,
                                      opacity: 0.7,
                                    }}
                                  />
                                </div>
                                <div className="text-[8px] text-slate-500">{item.label}</div>
                                <div className="text-[8px] font-mono" style={{ color: item.color }}>{pct}%</div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ═══ Wall Assembly ═══ */}
          <Section
            title="Wall Assembly"
            icon={<Shield className="w-4 h-4 text-emerald-400" />}
            count={walls.length}
          >
            {/* Aggregate */}
            <div className="flex items-center justify-between mb-3 p-2 rounded-lg bg-slate-800/30">
              <div className="text-[10px] text-slate-400">
                <span className="font-mono text-slate-300">{totalWallLength.toFixed(0)}</span> ft total · Avg R-<span className="font-mono text-emerald-400">{avgWallR}</span>
              </div>
              {poorWalls > 0 && (
                <span className="text-[9px] text-amber-400 font-bold">{poorWalls} need upgrade</span>
              )}
            </div>

            <div className="space-y-1.5">
              {walls.map(wall => (
                <div
                  key={wall.wallId}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  onClick={() => selectOnCanvas('wall-', wall.wallId)}
                >
                  {/* Color indicator */}
                  <div
                    className="w-1.5 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: GRADE_COLORS[wall.grade] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-300 font-mono truncate">
                        {wall.material.replace('_', ' ')} · {wall.lengthFt} ft
                      </span>
                      <GradeBadge grade={wall.grade} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[9px] text-slate-500">R-<span className="text-slate-300 font-mono">{wall.rValue}</span></span>
                      <span className="text-[9px] text-slate-500">U-<span className="text-slate-300 font-mono">{wall.uFactor}</span></span>
                      <span className="text-[9px] text-orange-400 font-mono">{wall.heatLossPerFt} BTU/ft</span>
                    </div>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0" />
                </div>
              ))}
            </div>
          </Section>

          {/* ═══ Window Performance ═══ */}
          <Section
            title="Window Performance"
            icon={<Sun className="w-4 h-4 text-sky-400" />}
            count={windows.length}
          >
            {/* Aggregate */}
            <div className="flex items-center justify-between mb-3 p-2 rounded-lg bg-slate-800/30">
              <div className="text-[10px] text-slate-400">
                <span className="font-mono text-slate-300">{totalWindowArea.toFixed(1)}</span> ft² total · Avg U-<span className="font-mono text-sky-400">{avgWindowU}</span>
              </div>
              {poorWindows > 0 && (
                <span className="text-[9px] text-amber-400 font-bold">{poorWindows} need upgrade</span>
              )}
            </div>

            <div className="space-y-1.5">
              {windows.map(win => (
                <div
                  key={win.openingId}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  onClick={() => selectOnCanvas('opening-', win.openingId)}
                >
                  <div
                    className="w-1.5 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: GRADE_COLORS[win.grade] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-300 font-mono">{win.areaSqFt} ft²</span>
                      <GradeBadge grade={win.grade} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[9px] text-slate-500">U-<span className="text-sky-300 font-mono">{win.uFactor}</span></span>
                      <span className="text-[9px] text-slate-500">SHGC <span className="text-amber-300 font-mono">{win.shgc}</span></span>
                      <span className="text-[9px] text-orange-400 font-mono">{win.heatingLoss} BTU loss</span>
                      <span className="text-[9px] text-sky-400 font-mono">{win.peakSolarGain} BTU gain</span>
                    </div>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0" />
                </div>
              ))}
              {windows.length === 0 && (
                <p className="text-[10px] text-slate-500 italic">No windows placed. Use the Window tool (I) to add windows.</p>
              )}
            </div>
          </Section>

          {/* ═══ Recommendations ═══ */}
          {hasRooms && wholeHouse && (
            <Section
              title="Recommendations"
              icon={<Zap className="w-4 h-4 text-amber-400" />}
              defaultOpen={false}
            >
              <div className="space-y-2">
                {poorWalls > 0 && (
                  <RecommendationCard
                    severity="warning"
                    title={`${poorWalls} wall${poorWalls > 1 ? 's' : ''} below R-13`}
                    description="Upgrade to R-19 or higher insulation to reduce heating load. Select each wall to edit its R-value."
                  />
                )}
                {poorWindows > 0 && (
                  <RecommendationCard
                    severity="warning"
                    title={`${poorWindows} window${poorWindows > 1 ? 's' : ''} above U-0.50`}
                    description="Consider low-E double or triple pane glass. Click windows to change glass type in properties."
                  />
                )}
                {wholeHouse.sensibleHeatRatio < 0.70 && (
                  <RecommendationCard
                    severity="info"
                    title="High latent load detected"
                    description={`SHR ${(wholeHouse.sensibleHeatRatio * 100).toFixed(0)}% — consider a variable-speed or two-stage system with enhanced dehumidification.`}
                  />
                )}
                {recommendedTons > 0 && (
                  <RecommendationCard
                    severity="success"
                    title={`Recommended: ${recommendedTons.toFixed(1)} ton system`}
                    description={`Based on ${fmtBtu(totalCoolingBtu)} BTU/hr cooling load. Verify with AHRI equipment selection.`}
                  />
                )}
                {rooms.some(r => r.heatingIntensity > 40) && (
                  <RecommendationCard
                    severity="warning"
                    title="High-intensity rooms detected"
                    description="Rooms over 40 BTU/ft² may need supplemental heating or envelope improvements. Check wall insulation and window area."
                  />
                )}
              </div>
            </Section>
          )}

        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-900/80">
          <div className="flex items-center justify-between text-[9px] text-slate-600">
            <span>ACCA Manual J 8th Ed. · ASHRAE 90.1</span>
            <span className="font-mono">{walls.length}W · {windows.length}O · {rooms.length}R</span>
          </div>
        </div>
      </div>

      {/* Resize Handle */}
      <div
        className="w-2 cursor-col-resize flex items-center justify-center hover:bg-emerald-500/20 transition-colors group"
        onMouseDown={onResizeStart}
      >
        <GripVertical className="w-3 h-3 text-slate-700 group-hover:text-emerald-400 transition-colors" />
      </div>
    </div>
  );
}

// ── Recommendation Card ──────────────────────────────────────────────────────

function RecommendationCard({
  severity,
  title,
  description,
}: {
  severity: 'warning' | 'info' | 'success';
  title: string;
  description: string;
}) {
  const styles = {
    warning: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />, title: 'text-amber-300' },
    info: { border: 'border-sky-500/20', bg: 'bg-sky-500/5', icon: <Wind className="w-3.5 h-3.5 text-sky-400" />, title: 'text-sky-300' },
    success: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />, title: 'text-emerald-300' },
  }[severity];

  return (
    <div className={`p-3 rounded-xl border ${styles.border} ${styles.bg}`}>
      <div className="flex items-center gap-2 mb-1">
        {styles.icon}
        <span className={`text-[11px] font-bold ${styles.title}`}>{title}</span>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed ml-5">{description}</p>
    </div>
  );
}
