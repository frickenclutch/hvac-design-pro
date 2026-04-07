import CadCanvas from '../features/cad/components/CadCanvas';
import Toolbox from '../features/cad/components/Toolbox';
import PropertyInspector from '../features/cad/components/PropertyInspector';
import TopNavigationBar from '../features/cad/components/TopNavigationBar';
import WallLengthOverlay from '../features/cad/components/WallLengthOverlay';
import FloorSelector from '../features/cad/components/FloorSelector';
import LayerManager from '../features/cad/components/LayerManager';
import { useAutoSave } from '../features/cad/hooks/useAutoSave';

export default function CadWorkspace() {
  // Auto-save drawing to D1 / localStorage
  useAutoSave();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 font-sans text-slate-100 overflow-hidden">

      {/* Edge-to-edge canvas (bottom layer) */}
      <CadCanvas />

      {/* Global header overlaid on canvas */}
      <TopNavigationBar />

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

    </div>
  );
}
