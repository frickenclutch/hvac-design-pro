import { useState, useEffect, useCallback } from 'react';
import {
  FileText, CheckCircle, XCircle, ArrowRight, Thermometer, Sun, PackageCheck, GitBranch,
} from 'lucide-react';
import { useProjectStore } from '../stores/useProjectStore';
import ProjectContextBar from '../components/ProjectContextBar';
import ProjectGateDialog from '../components/ProjectGateDialog';
import { scopedKey } from '../utils/storage';
import type { WholeHouseResult } from '../engines/manualJ';
import type { AedResult } from '../engines/aed';
import type { ManualSResult } from '../engines/manualS';
import type { ManualDResult } from '../engines/manualD';
import {
  generateCombinedReport,
  recomputeManualS,
  recomputeManualD,
  type StoredManualSInputs,
  type StoredManualDInputs,
} from '../features/reports/combinedReportGenerator';

// ── Project-scoped storage keys (match the calculator pages exactly) ──────────
function mjResultsKey(projectId: string | null): string {
  return scopedKey(`hvac_manualj_results_${projectId || 'draft'}`);
}
function aedResultsKey(projectId: string | null): string {
  return scopedKey(`hvac_aed_results_${projectId || 'draft'}`);
}
function manualSInputsKey(projectId: string | null): string {
  return scopedKey(`hvac_manuals_inputs_${projectId || 'draft'}`);
}
function manualDInputsKey(projectId: string | null): string {
  return scopedKey(`hvac_manuald_inputs_${projectId || 'draft'}`);
}

/** Safely parse a JSON localStorage value; null on absence or corruption. */
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

interface GatheredData {
  manualJ: WholeHouseResult | null;
  aed: AedResult | null;
  manualS: ManualSResult | null;
  manualD: ManualDResult | null;
}

const EMPTY: GatheredData = { manualJ: null, aed: null, manualS: null, manualD: null };

/** Read + recompute every tool's data for the active project. Pure + defensive. */
function gather(projectId: string | null, projectName: string): GatheredData {
  // Manual J — results read directly.
  let manualJ: WholeHouseResult | null = null;
  const mj = safeParse<WholeHouseResult>(localStorage.getItem(mjResultsKey(projectId)));
  if (mj && typeof mj.totalCoolingBtu === 'number' && Array.isArray(mj.rooms)) manualJ = mj;

  // AED — results read directly (must look like an AedResult).
  let aed: AedResult | null = null;
  const aedRaw = safeParse<AedResult>(localStorage.getItem(aedResultsKey(projectId)));
  if (aedRaw && typeof aedRaw.peakLoad === 'number' && Array.isArray(aedRaw.hourlyLoads)) aed = aedRaw;

  // Manual S — recompute from stored flat inputs.
  let manualS: ManualSResult | null = null;
  const msInputs = safeParse<StoredManualSInputs>(localStorage.getItem(manualSInputsKey(projectId)));
  if (msInputs && typeof msInputs.totalCoolingBtu === 'number') {
    try { manualS = recomputeManualS(msInputs, projectName || 'Manual S Selection'); } catch { manualS = null; }
  }

  // Manual D — recompute from stored inputs (null when there are no runs).
  let manualD: ManualDResult | null = null;
  const mdInputs = safeParse<StoredManualDInputs>(localStorage.getItem(manualDInputsKey(projectId)));
  if (mdInputs && Array.isArray(mdInputs.rooms) && mdInputs.rooms.length > 0) {
    try { manualD = recomputeManualD(mdInputs, projectName || 'Manual D Design'); } catch { manualD = null; }
  }

  return { manualJ, aed, manualS, manualD };
}

export default function CombinedReportPage() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProjectName = useProjectStore((s) => s.activeProjectName);

  // Project gate
  const [gateAccepted, setGateAccepted] = useState(!!activeProjectId);
  const showGate = !activeProjectId && !gateAccepted;

  const [data, setData] = useState<GatheredData>(EMPTY);
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(() => {
    setData(gather(activeProjectId, activeProjectName || ''));
  }, [activeProjectId, activeProjectName]);

  // Re-gather whenever the active project changes (and on mount).
  useEffect(() => {
    setGateAccepted(!!activeProjectId);
    reload();
  }, [activeProjectId, reload]);

  const hasAny = !!(data.manualJ || data.aed || data.manualS || data.manualD);

  const handleExport = useCallback(async () => {
    if (!hasAny) return;
    setGenerating(true);
    try {
      await generateCombinedReport({
        projectName: activeProjectName || 'Untitled Project',
        manualJ: data.manualJ,
        aed: data.aed,
        manualS: data.manualS,
        manualD: data.manualD,
      });
    } catch {
      alert('Failed to generate the combined report. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [hasAny, activeProjectName, data]);

  // One checklist row per tool, in report order (Manual J → AED → S → D).
  const rows: ChecklistRow[] = [
    {
      key: 'mj',
      label: 'Manual J — Load Calculation',
      icon: <Thermometer className="w-5 h-5" />,
      available: !!data.manualJ,
      summary: data.manualJ
        ? `${Math.round(data.manualJ.totalCoolingBtu).toLocaleString()} BTU/h cooling · ${data.manualJ.recommendedTons.toFixed(1)} tons · ${data.manualJ.rooms.length} rooms`
        : 'No Manual J results — run a Manual J calculation first.',
    },
    {
      key: 'aed',
      label: 'AED — Adequate Exposure Diversity',
      icon: <Sun className="w-5 h-5" />,
      available: !!data.aed,
      summary: data.aed
        ? `${data.aed.pass ? 'PASS' : 'FAIL'} · ratio ${data.aed.ratio.toFixed(2)} · peak ${Math.round(data.aed.peakLoad).toLocaleString()} BTU/h`
        : 'No AED results — run an AED analysis.',
    },
    {
      key: 'ms',
      label: 'Manual S — Equipment Selection',
      icon: <PackageCheck className="w-5 h-5" />,
      available: !!data.manualS,
      summary: data.manualS
        ? `${data.manualS.overallPass ? 'Within Manual S limits' : 'Needs review'} · cooling ${data.manualS.cooling.totalSizingPct}% of load`
        : 'No Manual S inputs — select equipment in Manual S.',
    },
    {
      key: 'md',
      label: 'Manual D — Duct Design',
      icon: <GitBranch className="w-5 h-5" />,
      available: !!data.manualD,
      summary: data.manualD
        ? `${data.manualD.runs.length} runs · ${data.manualD.designFrictionRate.toFixed(4)} inwg/100ft · ${data.manualD.isBalanced ? 'balanced' : 'needs balancing'}`
        : 'No Manual D inputs — define duct runs in Manual D.',
    },
  ];

  const availableCount = rows.filter((r) => r.available).length;

  return (
    <div className="h-full overflow-y-auto -webkit-overflow-scrolling-touch">
      {/* Project Gate Dialog */}
      {showGate && (
        <ProjectGateDialog
          onProjectSelected={() => setGateAccepted(true)}
          onDraft={() => setGateAccepted(true)}
        />
      )}

      {/* Project Context Bar */}
      <ProjectContextBar />

      <div className="max-w-6xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">

        {/* Header */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <FileText className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">
              {activeProjectName ? `${activeProjectName} — Reports` : 'Combined Report'}
            </h2>
          </div>
          <p className="text-slate-400 ml-14">
            Assemble one permit-ready PDF — Manual J loads, AED, Manual S equipment, and Manual D ducts —
            from this project&apos;s saved calculations. Only tools with data are included.
          </p>
        </header>

        {/* ═══ Tool Checklist ═══ */}
        <section className="glass-panel rounded-3xl border border-slate-800/60 p-8 mb-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Report Sections
            </h3>
            <span className="text-[11px] font-semibold text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2.5 py-1 rounded-lg">
              {availableCount} of {rows.length} available
            </span>
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.key}
                className={`flex items-start gap-4 p-5 rounded-2xl border transition-colors ${
                  row.available
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-slate-900/40 border-slate-800/60'
                }`}
              >
                <span
                  className={`inline-flex p-2 rounded-xl border shrink-0 ${
                    row.available
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                      : 'text-slate-500 bg-slate-500/10 border-slate-500/20'
                  }`}
                >
                  {row.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-white">{row.label}</span>
                    {row.available ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-lg">
                        <CheckCircle className="w-3 h-3" /> Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 bg-slate-500/10 border border-slate-500/30 px-2 py-0.5 rounded-lg">
                        <XCircle className="w-3 h-3" /> Missing
                      </span>
                    )}
                  </div>
                  <p className={`text-sm mt-1 ${row.available ? 'text-slate-300' : 'text-slate-500'}`}>
                    {row.summary}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══ Export ═══ */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExport}
            disabled={!hasAny || generating}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-base sm:text-lg hover:bg-emerald-400 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-3 min-h-[48px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {generating ? 'Building PDF…' : 'Export Combined PDF'} <ArrowRight className="w-5 h-5" />
          </button>
          <button
            onClick={reload}
            className="py-4 px-6 rounded-2xl bg-slate-800 text-slate-400 font-bold hover:text-white transition-colors flex items-center justify-center gap-2 min-h-[48px]"
          >
            Refresh
          </button>
        </div>

        {!hasAny && (
          <p className="text-sm text-slate-500 mt-4 text-center">
            No calculator data found for this project yet. Run Manual J, AED, Manual S, or Manual D first,
            then return here to assemble the combined report.
          </p>
        )}
      </div>
    </div>
  );
}

interface ChecklistRow {
  key: string;
  label: string;
  icon: React.ReactNode;
  available: boolean;
  summary: string;
}
