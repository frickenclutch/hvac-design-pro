/**
 * Version History — forensic-grade replay of every CAD save.
 *
 * Every save (create + auto-save) writes an immutable snapshot to the
 * cad_drawing_versions table on the server. This modal lists them
 * newest-first, lets the user inspect when + by whom each save happened,
 * and restore any prior state into the live canvas.
 *
 * The audit_log alongside is metadata-only ("Patrick edited Floor Plan"),
 * intentionally throttled to one row per drawing per 60s. The fidelity
 * trail lives here — every keystroke saved is a recoverable version,
 * regardless of how many subsequent saves overwrote it.
 *
 * Restoration semantics: clicking Restore APPENDS a new version (it does
 * not delete or overwrite history). The chain of restores is itself
 * forensically reconstructable.
 */

import { useEffect, useState, useMemo } from 'react';
import {
  X, History, RotateCcw, User, Clock, AlertTriangle, RefreshCw, Check, Eye,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useCadStore } from '../store/useCadStore';
import { toast } from '../../../stores/useToastStore';
import { useAccessPolicyStore } from '../../../stores/useAccessPolicyStore';

interface Version {
  id: string;
  version_number: number;
  size_bytes: number;
  thumbnail_key: string | null;
  author_user_id: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
  author_email: string | null;
  created_at: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Triggered when the user clicks Preview on a historical version.
   *  The parent (CadWorkspace) snapshots the current canvas, swaps in
   *  the version's state, and renders a banner with "Back to live" /
   *  "Restore this version" controls. */
  onPreview?: (info: {
    versionId: string;
    versionNumber: number;
    canvasJson: unknown;
    authorName: string;
    createdAt: string;
    totalVersions: number;
  }) => void;
}

export default function VersionHistoryModal({ isOpen, onClose, onPreview }: Props) {
  const drawingId = useCadStore((s) => s.drawingId);
  const loadDrawing = useCadStore((s) => s.loadDrawing);

  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const canRestore = useAccessPolicyStore((s) => s.capabilities.canRestoreVersions);

  const refresh = async () => {
    if (!drawingId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDrawingVersions(drawingId);
      setVersions(res.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Fetch on open. Re-fetch when the active drawing changes so switching
  // floors / projects without closing the modal still shows correct data.
  useEffect(() => {
    if (isOpen && drawingId) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, drawingId]);

  // Latest version's number for the "Current" badge in the row list.
  const latestNumber = useMemo(
    () => (versions.length > 0 ? versions[0].version_number : null),
    [versions],
  );

  const handlePreview = async (v: Version) => {
    if (!onPreview) return;
    setPreviewingId(v.id);
    try {
      const full = await api.getDrawingVersion(v.id);
      const authorName =
        [v.author_first_name, v.author_last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || v.author_email || 'Unknown user';
      onPreview({
        versionId: v.id,
        versionNumber: v.version_number,
        canvasJson: full.canvasJson,
        authorName,
        createdAt: v.created_at,
        totalVersions: versions.length,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewingId(null);
    }
  };

  const handleRestore = async (v: Version) => {
    const confirmMsg =
      `Restore version ${v.version_number} from ${new Date(v.created_at).toLocaleString()}?\n\n` +
      `Your current canvas state will be overwritten. A new version pointing at v${v.version_number}'s content will be appended — your current work is NOT lost, ` +
      `it remains as v${latestNumber}.`;
    if (!confirm(confirmMsg)) return;

    setRestoringId(v.id);
    try {
      await api.restoreDrawingVersion(v.id);
      // Refetch the live drawing — restore replaces canvas_json on the
      // server, the store needs to reflect that.
      if (drawingId) {
        const fresh = await api.getDrawing(drawingId);
        if (fresh?.canvasJson) {
          loadDrawing(fresh.canvasJson);
        }
      }
      toast.success(`Restored version ${v.version_number}`);
      await refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-2xl max-h-[85vh] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <History className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Version history</h2>
              <p className="text-xs text-slate-500">
                Every save is preserved forever — restore any prior state
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              disabled={loading || !drawingId}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 min-w-[40px] min-h-[40px] flex items-center justify-center"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-w-[40px] min-h-[40px] flex items-center justify-center"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!drawingId && (
            <EmptyState
              icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
              title="No saved drawing yet"
              subtitle="Save this drawing once to begin its version history. Auto-save creates a snapshot every time the canvas changes."
            />
          )}

          {drawingId && error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}

          {drawingId && !error && versions.length === 0 && !loading && (
            <EmptyState
              icon={<History className="w-5 h-5 text-slate-500" />}
              title="No versions found"
              subtitle="This is unexpected — every saved drawing should have at least one version. Try refreshing."
            />
          )}

          {drawingId && versions.length > 0 && (
            <div className="space-y-1">
              {versions.map((v) => {
                const authorName =
                  [v.author_first_name, v.author_last_name]
                    .filter(Boolean)
                    .join(' ')
                    .trim() || v.author_email || 'Unknown user';
                const isLatest = v.version_number === latestNumber;
                const restoring = restoringId === v.id;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${
                      isLatest
                        ? 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-slate-900/40 border-slate-800/60 hover:bg-slate-900/60'
                    } transition-colors`}
                  >
                    <div className="flex flex-col items-center justify-center w-10 flex-shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">v</div>
                      <div className="text-lg font-bold text-slate-200 tabular-nums leading-none">
                        {v.version_number}
                      </div>
                    </div>

                    {/* Visual thumbnail of the canvas state at this version.
                        thumbnail_key historically held an R2 key; for MVP we
                        store the data URL inline (see writeVersion in cad.ts).
                        Falls back to a placeholder when no thumbnail was
                        captured — e.g. versions saved before this feature
                        shipped, or versions where toDataURL failed. */}
                    {v.thumbnail_key ? (
                      <img
                        src={v.thumbnail_key}
                        alt={`Version ${v.version_number} preview`}
                        className="w-20 h-14 object-cover rounded border border-slate-800/80 bg-slate-950 flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-20 h-14 rounded border border-dashed border-slate-800 bg-slate-950/60 flex items-center justify-center flex-shrink-0">
                        <span className="text-[9px] uppercase tracking-wider text-slate-700">no preview</span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="font-medium text-slate-200 truncate">{authorName}</span>
                        {isLatest && (
                          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1" title={v.created_at}>
                          <Clock className="w-3 h-3" />
                          {formatRelative(v.created_at)}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono">{formatBytes(v.size_bytes)}</span>
                      </div>
                    </div>

                    {!isLatest && (
                      <div className="flex items-center gap-1">
                        {/* Preview is non-destructive — loads the version
                            state into the canvas read-only while auto-save
                            is suppressed. Restore can be invoked from the
                            preview banner after inspecting. */}
                        {onPreview && (
                          <button
                            onClick={() => void handlePreview(v)}
                            disabled={previewingId === v.id || restoring}
                            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-sky-500/20 hover:text-sky-300 hover:border-sky-500/30 text-slate-300 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition-colors min-h-[36px] disabled:opacity-50"
                            title={`Preview version ${v.version_number} without changing the live state`}
                          >
                            {previewingId === v.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                            Preview
                          </button>
                        )}
                        {canRestore && (
                          <button
                            onClick={() => void handleRestore(v)}
                            disabled={restoring}
                            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30 text-slate-300 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition-colors min-h-[36px] disabled:opacity-50"
                            title={`Restore version ${v.version_number}`}
                          >
                            {restoring ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Restore
                          </button>
                        )}
                      </div>
                    )}
                    {isLatest && (
                      <div className="px-3 py-2 rounded-lg text-emerald-400 text-xs font-bold flex items-center gap-1.5 min-h-[36px]">
                        <Check className="w-3.5 h-3.5" />
                        Live
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-slate-800 bg-slate-900/40 flex-shrink-0">
          <p className="text-[11px] text-slate-500 leading-snug">
            Versions are append-only — restoring a prior state does not erase the version you're on now. The full history is retained for audit, compliance, and dispute reconstruction.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="py-12 text-center">
      <div className="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">{subtitle}</p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const ms = Date.now() - d;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
