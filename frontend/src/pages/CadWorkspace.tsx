import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { scopedKey } from '../utils/storage';
import CadCanvas from '../features/cad/components/CadCanvas';
import Toolbox from '../features/cad/components/Toolbox';
import PropertyInspector from '../features/cad/components/PropertyInspector';
import TopNavigationBar from '../features/cad/components/TopNavigationBar';
import WallLengthOverlay from '../features/cad/components/WallLengthOverlay';
import FloorSelector from '../features/cad/components/FloorSelector';
import LayerManager from '../features/cad/components/LayerManager';
import ThermalLegend from '../features/cad/components/ThermalLegend';
import HelpCenter from '../features/cad/components/HelpCenter';
import VersionHistoryModal from '../features/cad/components/VersionHistoryModal';
import VersionPreviewBanner from '../features/cad/components/VersionPreviewBanner';
import { api } from '../lib/api';
import { useAutoSave, loadDrawing } from '../features/cad/hooks/useAutoSave';
import { useCadStore, type SerializedDrawing } from '../features/cad/store/useCadStore';
import { useAccessPolicyStore } from '../stores/useAccessPolicyStore';
import Mason from '../components/Mason';
import ErrorBoundary from '../components/ErrorBoundary';
import ProjectGateDialog from '../components/ProjectGateDialog';
import { useProjectStore } from '../stores/useProjectStore';
import { toast } from '../stores/useToastStore';

export default function CadWorkspace() {
  // Auto-save drawing to D1 / localStorage
  useAutoSave();
  const [helpOpen, setHelpOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

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
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const loadedProjectRef = useRef<string | null>(null);

  // Project gate — CAD produces project-scoped data, so entering it from the
  // sidebar (`/cad`, no route id) with no active project must prompt for a
  // project or an explicit draft, exactly like the calculators (§4.2). Without
  // this, CAD silently dropped the user onto whatever geometry was last in the
  // store/draft cache — "loads but isn't blank". Arriving via
  // /project/:id/cad (id present) is an explicit choice and skips the gate.
  const [gateAccepted, setGateAccepted] = useState(false);
  const showGate = !id && !activeProjectId && !gateAccepted;

  useEffect(() => {
    if (id) {
      setActiveProject(id);
    }
    // Deliberately NO cleanup: leaving the CAD workspace must not clear the
    // active project. It used to, which re-opened the project gate dialog on
    // every CAD round-trip and reset the calculators to draft data — the
    // active project is workbench state and persists until the user switches.
  }, [id, setActiveProject]);

  // ── Load saved CAD drawing data when entering a project ──────────────
  // Keyed on both the route id AND the reactive activeProjectId so a project
  // chosen from the gate dialog (which sets activeProjectId, not the route)
  // triggers its drawing to load.
  useEffect(() => {
    // Hold off until the user has resolved the gate — don't load draft
    // geometry behind the dialog only to replace it when they pick a project.
    if (showGate) return;
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
      // Draft mode: preserve any geometry already in the store (e.g. from
      // Manual J → Export to CAD). If the store is empty, try loading from
      // localStorage persistence.
      const hasGeometry = store.floors.some(
        f => f.walls.length > 0 || f.rooms.length > 0
      );
      if (!hasGeometry) {
        try {
          const saved = localStorage.getItem(scopedKey('hvac_cad_drawing'));
          if (saved) {
            const data = JSON.parse(saved) as Partial<SerializedDrawing>;
            const savedHasGeometry = data.floors?.some(
              (f) => (f.walls?.length || 0) > 0 || (f.rooms?.length || 0) > 0
            );
            if (savedHasGeometry) {
              store.loadDrawing(data);
            }
          }
        } catch { /* start fresh */ }
      }
      store.setProjectId(null);
      store.setDrawingId(null);
    }
  }, [id, activeProjectId, showGate]);

  // Draft chosen from the gate: start a genuinely blank canvas (unless
  // geometry was just handed in from Manual J → Export to CAD), matching the
  // user's "new canvas" intent rather than resurrecting a stale draft.
  const handleDraft = () => {
    const store = useCadStore.getState();
    const hasGeometry = store.floors.some(f => f.walls.length > 0 || f.rooms.length > 0);
    if (!hasGeometry) {
      store.loadDrawing({});
      store.setProjectId(null);
      store.setDrawingId(null);
    }
    setGateAccepted(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 font-sans text-slate-100 overflow-hidden">

      {/* Edge-to-edge canvas (bottom layer) */}
      <ErrorBoundary label="CAD Canvas">
        <CadCanvas />
      </ErrorBoundary>

      {/* Global header overlaid on canvas (contains 3D Viewer + PDF export) */}
      <ErrorBoundary label="Navigation">
        <TopNavigationBar
          onHelpOpen={() => setHelpOpen(true)}
          onVersionsOpen={() => setVersionsOpen(true)}
        />
      </ErrorBoundary>

      {/* Multi-floor selector (below header) */}
      <FloorSelector />

      {/* Left side floating toolbox */}
      <Toolbox />

      {/* Right side floating properties panel */}
      <ErrorBoundary label="Property Inspector">
        <PropertyInspector />
      </ErrorBoundary>

      {/* Layer visibility controls */}
      <ErrorBoundary label="Layer Manager">
        <LayerManager />
      </ErrorBoundary>

      {/* Live wall length / selection HUD overlay */}
      <WallLengthOverlay />

      {/* Thermal overlay legend (visible when thermal mode active) */}
      <ThermalLegend />

      {/* Mason — AI HVAC Assistant (complete help & docs built in) */}
      <Mason context="cad" position="bottom-left" />

      {/* Help Center modal */}
      <HelpCenter isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Version history modal — append-only forensic snapshot trail */}
      <VersionHistoryModal
        isOpen={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        onPreview={enterPreview}
      />

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

    </div>
  );
}
