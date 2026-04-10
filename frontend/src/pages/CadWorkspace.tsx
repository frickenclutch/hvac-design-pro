import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CadCanvas from '../features/cad/components/CadCanvas';
import Toolbox from '../features/cad/components/Toolbox';
import PropertyInspector from '../features/cad/components/PropertyInspector';
import TopNavigationBar from '../features/cad/components/TopNavigationBar';
import WallLengthOverlay from '../features/cad/components/WallLengthOverlay';
import FloorSelector from '../features/cad/components/FloorSelector';
import LayerManager from '../features/cad/components/LayerManager';
import ThermalLegend from '../features/cad/components/ThermalLegend';
import HelpCenter from '../features/cad/components/HelpCenter';
import { useAutoSave } from '../features/cad/hooks/useAutoSave';
import Mason from '../components/Mason';
import ErrorBoundary from '../components/ErrorBoundary';
import { useProjectStore } from '../stores/useProjectStore';

export default function CadWorkspace() {
  // Auto-save drawing to D1 / localStorage
  useAutoSave();
  const [helpOpen, setHelpOpen] = useState(false);

  // Hydrate the active project store from the route param
  const { id } = useParams<{ id: string }>();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);

  useEffect(() => {
    if (id) {
      setActiveProject(id);
    }
    return () => clearActiveProject();
  }, [id, setActiveProject, clearActiveProject]);

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
      <PropertyInspector />

      {/* Layer visibility controls */}
      <LayerManager />

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
