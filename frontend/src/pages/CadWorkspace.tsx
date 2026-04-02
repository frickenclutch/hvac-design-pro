import CadCanvas from '../features/cad/components/CadCanvas';
import Toolbox from '../features/cad/components/Toolbox';
import PropertyInspector from '../features/cad/components/PropertyInspector';
import TopNavigationBar from '../features/cad/components/TopNavigationBar';
import WallLengthOverlay from '../features/cad/components/WallLengthOverlay';

export default function CadWorkspace() {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 font-sans text-slate-100 overflow-hidden">

      {/* Edge-to-edge canvas (bottom layer) */}
      <CadCanvas />

      {/* Global header overlaid on canvas */}
      <TopNavigationBar />

      {/* Left side floating toolbox */}
      <Toolbox />

      {/* Right side floating properties panel */}
      <PropertyInspector />

      {/* Live wall length / selection HUD overlay */}
      <WallLengthOverlay />

    </div>
  );
}
