/**
 * VersionPreviewBanner — sits below the top nav while the user is peeking
 * at a historical version. The banner is the only visible cue that the
 * canvas state on screen isn't live, plus the only path back to the live
 * state (or to commit the restore).
 *
 * Auto-save is suppressed via cadStore.previewMode while this banner is
 * visible — see useAutoSave hook. The parent (CadWorkspace) manages the
 * snapshot lifecycle: stash live state on enter, restore on exit.
 */

import { Eye, RotateCcw, X, RefreshCw } from 'lucide-react';

interface Props {
  versionNumber: number;
  totalVersions: number;
  authorName: string;
  createdAt: string;
  busy?: boolean;
  /** Hide the Restore action when the caller's role can't restore
   *  (policy-gated). They can still inspect + Back to live. */
  canRestore?: boolean;
  onExit: () => void;
  onRestore: () => void;
}

export default function VersionPreviewBanner({
  versionNumber, totalVersions, authorName, createdAt, busy, canRestore = true, onExit, onRestore,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[72px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-2xl glass-panel border border-sky-500/40 shadow-[0_8px_30px_rgba(56,189,248,0.25)] backdrop-blur-xl"
    >
      <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
        <Eye className="w-3.5 h-3.5 text-sky-300" />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold text-sky-200">
            Viewing v{versionNumber}
          </span>
          <span className="text-slate-500">of {totalVersions}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
            Read-only
          </span>
        </div>
        <div className="text-[11px] text-slate-400">
          {authorName} · {new Date(createdAt).toLocaleString()}
        </div>
      </div>

      <div className="flex items-center gap-1.5 ml-3">
        {canRestore && (
          <button
            onClick={onRestore}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 min-h-[36px] disabled:opacity-50"
            title="Make this version the new live state (creates a new version pointing at this content)"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Restore this version
          </button>
        )}
        <button
          onClick={onExit}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 min-h-[36px] disabled:opacity-50"
          title="Discard preview and return to the live drawing"
        >
          <X className="w-3.5 h-3.5" />
          Back to live
        </button>
      </div>
    </div>
  );
}
