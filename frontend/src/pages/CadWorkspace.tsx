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
import { useAutoSave, loadDrawing } from '../features/cad/hooks/useAutoSave';
import { useCadStore } from '../features/cad/store/useCadStore';
import Mason from '../components/Mason';
import ErrorBoundary from '../components/ErrorBoundary';
import { useProjectStore } from '../stores/useProjectStore';
import { toast } from '../stores/useToastStore';

export default function CadWorkspace() {
  // Auto-save drawing to D1 / localStorage
  useAutoSave();
  const [helpOpen, setHelpOpen] = useState(false);

  // Hydrate the active project store from the route param
  const { id } = useParams<{ id: string }>();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);
  const loadedProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (id) {
      setActiveProject(id);
    }
    return () => clearActiveProject();
  }, [id, setActiveProject, clearActiveProject]);

  // ── Load saved CAD drawing data when entering a project ──────────────
  useEffect(() => {
    const projectId = id ?? useProjectStore.getState().activeProjectId;
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
            const data = JSON.parse(saved);
            const savedHasGeometry = data.floors?.some(
              (f: any) => (f.walls?.length || 0) > 0 || (f.rooms?.length || 0) > 0
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
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 font-sans text-slate-100 overflow-hidden">

      {/* Edge-to-edge canvas (bottom layer) */}
      <ErrorBoundary label="CAD Canvas">
        <CadCanvas />
      </ErrorBoundary>

      {/* Global header overlaid on canvas (contains 3D Viewer + PDF export) */}
      <ErrorBoundary label="Navigation">
        <TopNavigationBar onHelpOpen={() => setHelpOpen(true)} />
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

    </div>
  );
}
