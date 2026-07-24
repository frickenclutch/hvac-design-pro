import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { History, FilePlus, ArrowLeft } from 'lucide-react';
import { scopedKey } from '../utils/storage';
import CadCanvas from '../features/cad/components/CadCanvas';
import Toolbox from '../features/cad/components/Toolbox';
import PropertyInspector from '../features/cad/components/PropertyInspector';
import BlueprintDialogs from '../features/cad/components/BlueprintDialogs';
import TopNavigationBar from '../features/cad/components/TopNavigationBar';
import WallLengthOverlay from '../features/cad/components/WallLengthOverlay';
import FloorSelector from '../features/cad/components/FloorSelector';
import LayerManager from '../features/cad/components/LayerManager';
import ThermalLegend from '../features/cad/components/ThermalLegend';
import HelpCenter from '../features/cad/components/HelpCenter';
import VersionHistoryModal from '../features/cad/components/VersionHistoryModal';
import VersionPreviewBanner from '../features/cad/components/VersionPreviewBanner';
import PlatformViewBanner from '../features/cad/components/PlatformViewBanner';
import { api } from '../lib/api';
import { useAutoSave, loadDrawing } from '../features/cad/hooks/useAutoSave';
import { useCadStore, type SerializedDrawing } from '../features/cad/store/useCadStore';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import ErrorBoundary from '../components/ErrorBoundary';
import ProjectGateDialog from '../components/ProjectGateDialog';
import { useProjectStore } from '../stores/useProjectStore';
import { toast } from '../stores/useToastStore';

export default function CadWorkspace({ platformView = false }: { platformView?: boolean } = {}) {
  // Auto-save drawing to D1 / localStorage. In platformView the store is held
  // in previewMode (set in the platform load effect below), which hard-disables
  // this hook — a cross-tenant view must never write back.
  useAutoSave();
  const [helpOpen, setHelpOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Read-only cross-tenant (L0) view: project + owning-org name for the banner.
  const [platformMeta, setPlatformMeta] = useState<{ projectName: string | null; orgName: string | null }>({
    projectName: null,
    orgName: null,
  });

  // Version-preview lifecycle. previewInfo carries the version we're
  // currently peeking at; liveSnapshotRef stashes the canvas state we
  // left behind so "Back to live" can restore without a server roundtrip
  // (and without the auto-save loop writing the previewed content back).
  const [previewInfo, setPreviewInfo] = useState<{
    versionId: string;
    versionNumber: number;
    authorName: string;
    createdAt: string;
    totalVersions: number;
  } | null>(null);
  const [restoringFromPreview, setRestoringFromPreview] = useState(false);
  const liveSnapshotRef = useRef<unknown | null>(null);
  const canRestoreVersions = useAccessPolicyStore((s) => s.capabilities.canRestoreVersions);

  const enterPreview = (info: {
    versionId: string;
    versionNumber: number;
    canvasJson: unknown;
    authorName: string;
    createdAt: string;
    totalVersions: number;
  }) => {
    // Snapshot the live canvas state before swapping. We use the store's
    // serializeDrawing so the round-trip back is structurally identical
    // (panels, zoom, pan offset all preserved).
    const store = useCadStore.getState();
    liveSnapshotRef.current = store.serializeDrawing();
    useCadStore.getState().setPreviewMode(true);
    useCadStore.getState().loadDrawing(info.canvasJson);
    setPreviewInfo({
      versionId: info.versionId,
      versionNumber: info.versionNumber,
      authorName: info.authorName,
      createdAt: info.createdAt,
      totalVersions: info.totalVersions,
    });
  };

  const exitPreview = () => {
    if (liveSnapshotRef.current) {
      useCadStore.getState().loadDrawing(liveSnapshotRef.current);
      liveSnapshotRef.current = null;
    }
    useCadStore.getState().setPreviewMode(false);
    setPreviewInfo(null);
  };

  const restoreFromPreview = async () => {
    if (!previewInfo) return;
    setRestoringFromPreview(true);
    try {
      await api.restoreDrawingVersion(previewInfo.versionId);
      // Re-fetch the live drawing — restore writes a new latest version
      // server-side. Loading it puts the store in sync with the new live
      // state without keeping any preview artifact around.
      const drawingId = useCadStore.getState().drawingId;
      if (drawingId) {
        const fresh = await api.getDrawing(drawingId);
        if (fresh?.canvasJson) {
          useCadStore.getState().loadDrawing(fresh.canvasJson);
        }
      }
      liveSnapshotRef.current = null;
      useCadStore.getState().setPreviewMode(false);
      setPreviewInfo(null);
      toast.success(`Restored version ${previewInfo.versionNumber}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setRestoringFromPreview(false);
    }
  };

  // Hydrate the active project store from the route param
  const { id } = useParams<{ id: string }>();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const hydrateActiveProjectMeta = useProjectStore((s) => s.hydrateActiveProjectMeta);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const loadedProjectRef = useRef<string | null>(null);

  // Project gate — CAD produces project-scoped data, so entering it from the
  // sidebar (`/cad`, no route id) with no active project must prompt for a
  // project or an explicit draft, exactly like the calculators (§4.2). Without
  // this, CAD silently dropped the user onto whatever geometry was last in the
  // store/draft cache — "loads but isn't blank". Arriving via
  // /project/:id/cad (id present) is an explicit choice and skips the gate.
  const [gateAccepted, setGateAccepted] = useState(false);
  // Secondary "resume vs blank" choice, shown after Continue as Draft when
  // there IS a resumable draft. forceBlankDraftRef carries the user's pick
  // into the load effect below.
  const [draftChoiceOpen, setDraftChoiceOpen] = useState(false);
  const forceBlankDraftRef = useRef(false);
  // platformView is an explicit L0 read-only route (id always present), so it
  // never shows the gate.
  const showGate = !platformView && !id && !activeProjectId && !gateAccepted && !draftChoiceOpen;

  useEffect(() => {
    // The read-only platform viewer loads through its own effect below and must
    // NOT touch the admin's own active-project state.
    if (platformView) return;
    if (id) {
      setActiveProject(id);
      // A cache miss (a teammate's same-org project, a deep link) leaves the
      // name null — pull it from the server so ProjectContextBar isn't blank.
      void hydrateActiveProjectMeta(id);
    }
    // Deliberately NO cleanup: leaving the CAD workspace must not clear the
    // active project. It used to, which re-opened the project gate dialog on
    // every CAD round-trip and reset the calculators to draft data — the
    // active project is workbench state and persists until the user switches.
  }, [id, platformView, setActiveProject, hydrateActiveProjectMeta]);

  // ── Load saved CAD drawing data when entering a project ──────────────
  // Keyed on both the route id AND the reactive activeProjectId so a project
  // chosen from the gate dialog (which sets activeProjectId, not the route)
  // triggers its drawing to load.
  useEffect(() => {
    // Platform view has its own loader (fetches cross-tenant via the audited
    // L0 endpoints); the org-scoped path below would only 404 the foreign id.
    if (platformView) return;
    // Hold off until the user has resolved the gate (and the draft choice) —
    // don't load geometry behind a dialog only to replace it once they pick.
    if (showGate || draftChoiceOpen) return;
    const projectId = id ?? activeProjectId;
    // Skip if we already loaded this project (avoids re-loading on every render)
    if (loadedProjectRef.current === (projectId ?? '__draft__')) return;
    loadedProjectRef.current = projectId ?? '__draft__';

    const store = useCadStore.getState();

    if (projectId) {
      // Reset geometry to a clean slate — prevents data from a previous
      // project bleeding in. Preserve panel UI state (user preference).
      const preserveUI = {
        panelToolbox: store.panelToolbox,
        panelProperties: store.panelProperties,
        panelFloors: store.panelFloors,
        panelNavBar: store.panelNavBar,
        ghostingEnabled: store.ghostingEnabled,
      };
      store.loadDrawing({});
      // Restore panel state immediately so toolbox doesn't vanish
      useCadStore.setState(preserveUI);
      store.setProjectId(projectId);
      store.setDrawingId(null);

      // Load this project's saved drawing from localStorage / D1
      loadDrawing(projectId).then((saved) => {
        // Guard: only apply if we're still on the same project
        if (loadedProjectRef.current !== (projectId ?? '__draft__')) return;
        if (saved?.canvasJson) {
          useCadStore.getState().loadDrawing(saved.canvasJson);
          if (saved.id) useCadStore.getState().setDrawingId(saved.id);
        }
      }).catch(() => {
        toast.error('Failed to load drawing. Starting with a blank canvas.');
      });
    } else {
      // Draft mode. If the user explicitly chose "start blank", wipe to an
      // empty canvas. Otherwise preserve any geometry already in the store
      // (e.g. from Manual J → Export to CAD) and, if empty, resume the saved
      // localStorage draft.
      if (forceBlankDraftRef.current) {
        store.loadDrawing({});
      } else {
        const hasGeometry = store.floors.some(
          f => f.walls.length > 0 || f.rooms.length > 0 || (f.underlays?.length ?? 0) > 0
        );
        if (!hasGeometry) {
          try {
            const saved = localStorage.getItem(scopedKey('hvac_cad_drawing'));
            if (saved) {
              const data = JSON.parse(saved) as Partial<SerializedDrawing>;
              const savedHasGeometry = data.floors?.some(
                (f) => (f.walls?.length || 0) > 0 || (f.rooms?.length || 0) > 0 || (f.underlays?.length || 0) > 0
              );
              if (savedHasGeometry) {
                store.loadDrawing(data);
              }
            }
          } catch { /* start fresh */ }
        }
      }
      store.setProjectId(null);
      store.setDrawingId(null);
    }
  }, [id, platformView, activeProjectId, showGate, draftChoiceOpen]);

  // ── Read-only platform (L0) load ────────────────────────────────────────
  // Cross-tenant viewer: fetch the project + primary drawing through the
  // audited platform endpoints (no session swap, no org-scoped path) and hold
  // the store in previewMode so nothing can ever be written back.
  useEffect(() => {
    if (!platformView || !id) return;
    let cancelled = false;
    const store = useCadStore.getState();
    store.setPreviewMode(true);   // hard-disables useAutoSave
    store.loadDrawing({});        // clean slate before the foreign drawing lands
    store.setProjectId(id);
    store.setDrawingId(null);

    void (async () => {
      try {
        const [{ project, orgName }, { drawing }] = await Promise.all([
          api.platformGetProject(id),
          api.platformGetProjectDrawing(id),
        ]);
        if (cancelled) return;
        setPlatformMeta({ projectName: project.name, orgName });
        if (drawing?.canvasJson) {
          useCadStore.getState().loadDrawing(drawing.canvasJson);
          useCadStore.getState().setDrawingId(drawing.id);
        }
      } catch {
        if (!cancelled) toast.error('This project is no longer available.');
      }
    })();

    return () => {
      cancelled = true;
      // Leave no cross-tenant geometry (or previewMode) behind for the admin's
      // own next CAD session.
      const s = useCadStore.getState();
      s.setPreviewMode(false);
      s.loadDrawing({});
      s.setProjectId(null);
      s.setDrawingId(null);
    };
  }, [platformView, id]);

  // "Continue as Draft" from the gate. If there's a resumable draft (geometry
  // already in the store, or a saved localStorage draft), let the user decide
  // between resuming it and starting a blank canvas. If there's nothing to
  // resume, go straight to a blank canvas.
  const handleDraft = () => {
    const store = useCadStore.getState();
    const storeHasGeometry = store.floors.some(
      f => f.walls.length > 0 || f.rooms.length > 0 || (f.underlays?.length ?? 0) > 0
    );
    let savedHasGeometry = false;
    try {
      const saved = localStorage.getItem(scopedKey('hvac_cad_drawing'));
      if (saved) {
        const data = JSON.parse(saved) as Partial<SerializedDrawing>;
        savedHasGeometry = data.floors?.some(
          (f) => (f.walls?.length || 0) > 0 || (f.rooms?.length || 0) > 0 || (f.underlays?.length || 0) > 0
        ) ?? false;
      }
    } catch { /* ignore */ }

    if (storeHasGeometry || savedHasGeometry) {
      setDraftChoiceOpen(true);
    } else {
      forceBlankDraftRef.current = true;
      setGateAccepted(true);
    }
  };

  const startBlankDraft = () => {
    forceBlankDraftRef.current = true;
    setDraftChoiceOpen(false);
    setGateAccepted(true);
  };

  const resumeDraft = () => {
    forceBlankDraftRef.current = false;
    setDraftChoiceOpen(false);
    setGateAccepted(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 font-sans text-slate-100 overflow-hidden">

      {/* Edge-to-edge canvas (bottom layer) */}
      <ErrorBoundary label="CAD Canvas">
        <CadCanvas />
      </ErrorBoundary>

      {/* Read-only cross-tenant (L0) banner — replaces the editing header. */}
      {platformView && (
        <PlatformViewBanner
          projectName={platformMeta.projectName}
          orgName={platformMeta.orgName}
        />
      )}

      {/* Global header overlaid on canvas (contains 3D Viewer + PDF export).
          Hidden in the read-only platform view — its save/version/export
          affordances don't belong in a cross-tenant peek. */}
      {!platformView && (
        <ErrorBoundary label="Navigation">
          <TopNavigationBar
            onHelpOpen={() => setHelpOpen(true)}
            onVersionsOpen={() => setVersionsOpen(true)}
          />
        </ErrorBoundary>
      )}

      {/* Multi-floor selector (below header) */}
      <FloorSelector />

      {/* Left side floating toolbox — drawing tools; hidden read-only. */}
      {!platformView && <Toolbox />}

      {/* Right side floating properties panel — edits selected geometry;
          hidden read-only. */}
      {!platformView && (
        <ErrorBoundary label="Property Inspector">
          <PropertyInspector />
        </ErrorBoundary>
      )}

      {/* Layer visibility controls */}
      <ErrorBoundary label="Layer Manager">
        <LayerManager />
      </ErrorBoundary>

      {/* Live wall length / selection HUD overlay */}
      <WallLengthOverlay />

      {/* Thermal overlay legend (visible when thermal mode active) */}
      <ThermalLegend />

      {/* Blueprint intake: PDF page picker + scale calibration — write path;
          hidden read-only. */}
      {!platformView && <BlueprintDialogs />}

      {/* Help Center modal (opened from the header, which is itself hidden
          read-only). */}
      {!platformView && <HelpCenter isOpen={helpOpen} onClose={() => setHelpOpen(false)} />}

      {/* Version history modal — append-only forensic snapshot trail; restore
          is a write, so the whole modal is hidden read-only. */}
      {!platformView && (
        <VersionHistoryModal
          isOpen={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          onPreview={enterPreview}
        />
      )}

      {/* Preview banner — only rendered while peeking at a historical
          version. The banner is the single visible cue that on-screen
          state isn't live, and the only path back. */}
      {previewInfo && (
        <VersionPreviewBanner
          versionNumber={previewInfo.versionNumber}
          totalVersions={previewInfo.totalVersions}
          authorName={previewInfo.authorName}
          createdAt={previewInfo.createdAt}
          busy={restoringFromPreview}
          canRestore={canRestoreVersions}
          onExit={exitPreview}
          onRestore={() => void restoreFromPreview()}
        />
      )}

      {/* Project gate — rendered last, in a z-[60] layer so it sits above the
          canvas and every floating panel/modal in this z-50 workspace. */}
      {showGate && (
        <div className="fixed inset-0 z-[60]">
          <ProjectGateDialog
            onProjectSelected={() => setGateAccepted(true)}
            onDraft={handleDraft}
          />
        </div>
      )}

      {/* Draft resume-vs-blank choice — shown only when there's a resumable
          draft, so the user decides rather than the app guessing. */}
      {draftChoiceOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md mx-4 rounded-3xl border border-slate-700/60 shadow-2xl overflow-hidden">
            <div className="px-8 pt-8 pb-2">
              <h2 className="text-xl font-bold text-white mb-1">Continue your draft?</h2>
              <p className="text-sm text-slate-400">
                You have an unsaved draft drawing. Pick up where you left off, or start a fresh blank canvas.
              </p>
            </div>
            <div className="px-8 py-6 space-y-3">
              <button
                onClick={resumeDraft}
                className="w-full flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/15 transition-all text-left"
              >
                <History className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">Resume last draft</p>
                  <p className="text-[11px] text-slate-400">Reopen the drawing you were working on</p>
                </div>
              </button>
              <button
                onClick={startBlankDraft}
                className="w-full flex items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 transition-all text-left"
              >
                <FilePlus className="w-5 h-5 text-slate-300 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">Start a blank canvas</p>
                  <p className="text-[11px] text-slate-400">Begin a new drawing (your saved draft stays intact until you draw)</p>
                </div>
              </button>
            </div>
            <div className="px-8 py-4 border-t border-slate-800/60 bg-slate-900/30">
              <button
                onClick={() => setDraftChoiceOpen(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
