import { useState } from 'react';
import {
  BookOpen, ChevronRight, GraduationCap, Zap,
  Home, PenTool, Thermometer, Box, Layers, Building2,
  Keyboard, FileText, Settings, Compass,
  Eye, Lock,
  Printer, MessageSquarePlus,
  Wind, SquarePen, GitBranch, FolderOpen, Flame,
} from 'lucide-react';

type GuideMode = 'easy' | 'advanced';

interface GuideSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  easyContent: React.ReactNode;
  advancedContent: React.ReactNode;
}

const sections: GuideSection[] = [
  {
    id: 'overview',
    title: 'What is HVAC DesignPro?',
    icon: <Compass className="w-5 h-5 text-emerald-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>HVAC DesignPro is a web app that helps you <strong>design building floor plans</strong> and <strong>calculate heating & cooling loads</strong> — all in one place.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FeatureCard icon={<PenTool className="w-5 h-5" />} title="Draw" desc="Sketch walls, doors, and windows on a 2D canvas" />
          <FeatureCard icon={<Thermometer className="w-5 h-5" />} title="Calculate" desc="Run Manual J load calculations room by room" />
          <FeatureCard icon={<Printer className="w-5 h-5" />} title="Export" desc="Generate professional PDF blueprints" />
        </div>
        <p className="text-slate-500 text-xs">No installs needed — it runs entirely in your browser and saves to your device.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>HVAC DesignPro is a full-stack PWA built for HVAC engineers, contractors, and plan reviewers. It combines a Fabric.js-powered 2D CAD workspace, Three.js 3D visualization, and a Manual J (ACCA) load calculator in a single browser-based tool.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TechCard title="Stack" items={['React 19 + TypeScript', 'Fabric.js 7 (2D)', 'Three.js 0.183 (3D)', 'Zustand state management', 'Cloudflare Pages hosting']} />
          <TechCard title="Data" items={['All data in localStorage', 'Per-project isolation', 'Auto-save every 3s', 'PDF export via jsPDF', 'No server required']} />
        </div>
        <p className="text-slate-500 text-xs">The app is structured around three main stores: <code className="text-emerald-400/70">useCadStore</code> (floor plans), <code className="text-emerald-400/70">useProjectStore</code> (active project identity), and <code className="text-emerald-400/70">usePreferencesStore</code> (settings). Bidirectional sync between CAD geometry and Manual J inputs is handled by <code className="text-emerald-400/70">cadToManualJ.ts</code>.</p>
      </div>
    ),
  },
  {
    id: 'projects',
    title: 'Managing Projects',
    icon: <Home className="w-5 h-5 text-sky-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The <strong>Dashboard</strong> is your home base. Here you can:</p>
        <StepList steps={[
          'Click the green "+ New Project" button to create a project',
          'Choose Residential or Commercial and enter an address',
          'Click a project card to open it in the CAD workspace',
          'Hover a card and click the pencil icon to edit name, type, or address',
          'Use the red trash icon (in edit mode) to delete a project',
        ]} />
        <Tip>Your project name shows in the top bar of both the CAD workspace and 3D viewer.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Projects are stored in <code className="text-emerald-400/70">localStorage</code> under the key <code className="text-emerald-400/70">hvac_projects</code>. Each project object contains an <code className="text-emerald-400/70">id</code>, <code className="text-emerald-400/70">name</code>, <code className="text-emerald-400/70">type</code> (residential/commercial), <code className="text-emerald-400/70">address</code>, and timestamps.</p>
        <p>When you open a project via <code className="text-emerald-400/70">/project/:id/cad</code>, the <code className="text-emerald-400/70">useProjectStore</code> hydrates from localStorage and populates <code className="text-emerald-400/70">activeProjectName</code>, <code className="text-emerald-400/70">activeProjectType</code>, and <code className="text-emerald-400/70">activeProjectAddress</code>. These propagate to TopNavigationBar and Viewer3D.</p>
        <p>Inline editing on Dashboard tile cards patches the project in localStorage and triggers a re-render. The project identity is cleared on unmount when leaving the CAD workspace.</p>
      </div>
    ),
  },
  {
    id: 'cad-basics',
    title: 'CAD Workspace Basics',
    icon: <PenTool className="w-5 h-5 text-violet-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The CAD workspace is where you draw your building. Think of it as digital graph paper.</p>
        <StepList steps={[
          'Use the toolbar on the left to pick a drawing tool',
          'The dot grid = 1 foot squares (when zoomed to 100%)',
          'Scroll to zoom in/out, hold middle mouse button to pan',
          'Click objects with the Select tool (V) to see their properties on the right',
          'Press Delete or Backspace to remove selected objects',
        ]} />
        <div className="grid grid-cols-2 gap-2">
          <ToolCard shortcut="V" name="Select" desc="Click to pick objects" />
          <ToolCard shortcut="H" name="Pan" desc="Drag to move the view" />
          <ToolCard shortcut="W" name="Wall" desc="Click-click to draw walls" />
          <ToolCard shortcut="D" name="Dimension" desc="Measure distances" />
          <ToolCard shortcut="L" name="Label" desc="Add text notes" />
          <ToolCard shortcut="R" name="Rooms" desc="Auto-detect enclosed rooms" />
        </div>
        <Tip>Walls chain automatically — each new segment starts from the last endpoint. Right-click or double-click to stop.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>The CAD canvas uses <strong>Fabric.js 7</strong> with custom rendering for walls (dual-line with fill), openings (cutouts with swing arcs for doors), and HVAC symbols. Objects are identified by <code className="text-emerald-400/70">name</code> prefixes: <code className="text-emerald-400/70">wall-</code>, <code className="text-emerald-400/70">opening-</code>, <code className="text-emerald-400/70">hvac-</code>, <code className="text-emerald-400/70">pipe-</code>, <code className="text-emerald-400/70">ann-</code>, <code className="text-emerald-400/70">underlay-</code>.</p>
        <p>Selection is asymmetric: walls use <code className="text-emerald-400/70">selectedWallId</code> (string state) while all other objects use <code className="text-emerald-400/70">selectedObject</code> (Fabric.Object reference). The PropertyInspector reads the appropriate state and renders the matching panel.</p>
        <p><strong>Delete handling:</strong> The keydown handler in CadCanvas checks for <code className="text-emerald-400/70">selectedWallId</code> first, then falls through to <code className="text-emerald-400/70">selectedObject.name</code> prefix matching to dispatch the correct <code className="text-emerald-400/70">remove*</code> action (removeWall, removeOpening, removeHvacUnit, removePipe, removeAnnotation, removeUnderlay).</p>
        <p><strong>Grid snap:</strong> Configurable via Settings. Default 40px/ft. When enabled, wall endpoints round to the nearest grid intersection. Controlled by <code className="text-emerald-400/70">usePreferencesStore.gridSnap</code> and <code className="text-emerald-400/70">gridSpacing</code>.</p>
      </div>
    ),
  },
  {
    id: 'walls-openings',
    title: 'Walls, Windows & Doors',
    icon: <SquarePen className="w-5 h-5 text-emerald-400" />,
    easyContent: (
      <div className="space-y-3">
        <p><strong>Drawing walls:</strong></p>
        <StepList steps={[
          'Select the Wall tool (W)',
          'Click to start, move the mouse, click again to place',
          'Walls auto-connect in a chain — keep clicking for more segments',
          'Right-click or double-click to finish the chain',
        ]} />
        <p><strong>Adding windows & doors:</strong></p>
        <StepList steps={[
          'Select the Window or Door tool',
          'Click near an existing wall — the opening snaps to it automatically',
          'Select the opening to edit size, U-factor, and other properties in the right panel',
        ]} />
        <p><strong>Editing properties:</strong> Select any wall to change its thickness, R-value, and material (Insulated Wood Stud, CMU Block, or Poured Concrete). The U-factor is computed automatically.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Walls are stored as <code className="text-emerald-400/70">Wall</code> objects with <code className="text-emerald-400/70">x1,y1,x2,y2</code> endpoints plus metadata: <code className="text-emerald-400/70">thickness</code> (px), <code className="text-emerald-400/70">rValue</code>, <code className="text-emerald-400/70">material</code>. They render as dual parallel lines with fill based on material type.</p>
        <p>Openings (windows/doors) attach to walls via <code className="text-emerald-400/70">wallId</code> and <code className="text-emerald-400/70">position</code> (0–1 along wall length). Properties include <code className="text-emerald-400/70">width</code>, <code className="text-emerald-400/70">height</code>, <code className="text-emerald-400/70">uFactor</code>, <code className="text-emerald-400/70">shgc</code> (windows), and <code className="text-emerald-400/70">swing</code> (doors).</p>
        <p><strong>Thermal impact:</strong> Wall R-values and opening U-factors feed directly into Manual J calculations via the bidirectional sync engine. Changes to wall R-values in CAD or Manual J propagate both ways.</p>
      </div>
    ),
  },
  {
    id: 'hvac-pipes',
    title: 'HVAC Units & Piping',
    icon: <Wind className="w-5 h-5 text-rose-400" />,
    easyContent: (
      <div className="space-y-3">
        <p><strong>Placing HVAC equipment:</strong></p>
        <StepList steps={[
          'Select the HVAC tool from the toolbar',
          'Click anywhere on the floor plan to place a unit',
          'Use the Property Inspector (right panel) to set the type: Supply Register, Return Grille, Air Handler, Condenser, Thermostat, or Duct Run',
          'Set the CFM (airflow) rating and add a label',
        ]} />
        <p><strong>Drawing pipes:</strong></p>
        <StepList steps={[
          'Select the Pipe tool from the toolbar',
          'Click to start, click again to place segments',
          'Select a placed pipe to change material (Copper Liquid, Copper Suction, PVC Condensate, Gas Black Iron) and diameter',
          'The Property Inspector shows thermal info including estimated heat loss',
        ]} />
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>HVAC units are stored as <code className="text-emerald-400/70">HvacUnit</code> with type, position, cfm, and label. Pipe segments use the <code className="text-emerald-400/70">PipeSegment</code> type with <code className="text-emerald-400/70">PipeMaterial</code> union: <code className="text-emerald-400/70">copper_liquid | copper_suction | pvc_condensate | gas_black_iron</code>.</p>
        <p>The Pipe property panel calculates estimated heat loss per linear foot based on material thermal conductivity and pipe diameter. Each material renders with a distinct color and line style on the canvas.</p>
        <p>Pipes live on a dedicated <strong>Piping</strong> layer (controlled via the Layer Manager), allowing independent visibility/lock control from walls and openings.</p>
      </div>
    ),
  },
  {
    id: 'floors',
    title: 'Multi-Floor Design',
    icon: <Building2 className="w-5 h-5 text-amber-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>Design multi-story buildings floor by floor.</p>
        <StepList steps={[
          'The floor bar sits just below the top navigation',
          'Click "+ Add Floor" to create a new level',
          'Click a floor tab to switch to it — each floor has its own walls, openings, and equipment',
          'Toggle the eye icon to show/hide a floor\'s ghost outline on other floors',
          'Set custom ceiling heights per floor',
        ]} />
        <Tip>Ghost outlines from other floors appear as faded dashed lines — great for aligning stairways and duct chases.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Each <code className="text-emerald-400/70">Floor</code> in the CAD store has independent arrays for walls, openings, hvacUnits, pipes, annotations, and rooms. The floor bar renders tabs with visibility toggles that control <code className="text-emerald-400/70">ghostingEnabled</code>.</p>
        <p>Ghost floors render with reduced opacity via <code className="text-emerald-400/70">setLayerOpacity</code>. Locked floors prevent selection and editing. The 3D viewer stacks floors vertically using the <code className="text-emerald-400/70">ceilingHeight</code> of each floor as the Y offset.</p>
        <p>Floor slab geometry in 3D is computed from wall bounding box extents. A guard checks <code className="text-emerald-400/70">isFinite()</code> on all bounds before creating the slab mesh to prevent Infinity dimensions on empty floors.</p>
      </div>
    ),
  },
  {
    id: 'layers',
    title: 'Layer System',
    icon: <Layers className="w-5 h-5 text-cyan-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>Layers let you control what's visible and what's locked.</p>
        <div className="space-y-1.5">
          <LayerRow color="text-emerald-400" name="Walls" desc="Structural walls" />
          <LayerRow color="text-sky-400" name="Openings" desc="Windows & doors" />
          <LayerRow color="text-violet-400" name="HVAC" desc="Equipment & registers" />
          <LayerRow color="text-rose-400" name="Piping" desc="Refrigerant, condensate, gas lines" />
          <LayerRow color="text-amber-400" name="Annotations" desc="Labels, dimensions, notes" />
          <LayerRow color="text-slate-400" name="Underlay" desc="Imported floor plan images" />
        </div>
        <p className="text-xs text-slate-500">Toggle the <Eye className="w-3 h-3 inline" /> icon to show/hide. Click the <Lock className="w-3 h-3 inline" /> icon to prevent edits on a layer.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Layers are defined in the CAD store with <code className="text-emerald-400/70">id</code>, <code className="text-emerald-400/70">name</code>, <code className="text-emerald-400/70">visible</code>, <code className="text-emerald-400/70">locked</code>, <code className="text-emerald-400/70">opacity</code>, and <code className="text-emerald-400/70">color</code>. The <code className="text-emerald-400/70">activeLayerId</code> state determines the default layer for new objects.</p>
        <p>Layer visibility filters Fabric.js canvas objects during <code className="text-emerald-400/70">syncFloorToCanvas</code>. Locked layers set <code className="text-emerald-400/70">selectable: false, evented: false</code> on their objects. The <code className="text-emerald-400/70">soloLayer</code> action hides all others. Opacity is applied via Fabric object opacity matching the layer slider value.</p>
      </div>
    ),
  },
  {
    id: '3d-viewer',
    title: '3D Viewer',
    icon: <Box className="w-5 h-5 text-pink-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>See your floor plan come to life in 3D.</p>
        <StepList steps={[
          'Click "3D View" in the top navigation bar',
          'Left-click + drag to orbit (rotate) around the building',
          'Right-click + drag to pan the camera',
          'Scroll to zoom in and out',
          'Hover objects to see property tooltips',
          'Use floor toggles to show/hide individual stories',
          'Toggle wireframe or shadows with the icons in the corner',
          'Press Escape or click X to return to 2D',
        ]} />
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>The 3D viewer uses <strong>Three.js 0.183</strong> with <code className="text-emerald-400/70">OrbitControls</code> for camera interaction. The <code className="text-emerald-400/70">buildScene</code> callback iterates all visible floors and creates:</p>
        <ul className="list-disc list-inside text-sm text-slate-400 space-y-1">
          <li>Wall meshes: BoxGeometry extruded from wall thickness and ceiling height</li>
          <li>Opening cutouts: Transparent panes for windows, angled geometry for door swings</li>
          <li>HVAC symbols: Colored box meshes with type-based materials</li>
          <li>Floor slabs: Flat planes computed from wall bounding boxes (with <code className="text-emerald-400/70">isFinite</code> guards)</li>
          <li>Pipe runs: TubeGeometry following segment paths with material-colored meshes</li>
        </ul>
        <p>The <code className="text-emerald-400/70">visibleFloors</code> Set is stabilized in the dependency array via <code className="text-emerald-400/70">[...visibleFloors].sort().join(',')</code> to prevent unnecessary scene rebuilds.</p>
      </div>
    ),
  },
  {
    id: 'manual-j',
    title: 'Manual J Calculator',
    icon: <Thermometer className="w-5 h-5 text-orange-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The Manual J calculator figures out how much heating and cooling your building needs.</p>
        <StepList steps={[
          'Navigate to the Manual J page from the sidebar',
          'Click "Import from CAD" to pull in your floor plan data automatically',
          'Or add rooms manually with "+ Add Room"',
          'For each room, enter dimensions, wall R-values, window U-factors, and SHGC',
          'The calculator shows per-room and whole-building heating/cooling loads in BTU/h',
        ]} />
        <Tip>After making changes in Manual J, click "Sync to CAD" to push your edits (like updated R-values) back to the floor plan.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Manual J implements the ACCA residential load calculation methodology. The engine in <code className="text-emerald-400/70">cadToManualJ.ts</code> provides two key functions:</p>
        <ul className="list-disc list-inside text-sm text-slate-400 space-y-1">
          <li><code className="text-emerald-400/70">convertCadRoomsToManualJ(floor)</code> — converts a single floor's detected rooms into <code className="text-emerald-400/70">RoomInput</code> objects, mapping wall R-values, opening U-factors, and SHGC</li>
          <li><code className="text-emerald-400/70">convertAllFloorsToManualJ(floors)</code> — aggregates all floors, tagging each <code className="text-emerald-400/70">ConvertedRoom</code> with <code className="text-emerald-400/70">cadRoomId</code>, <code className="text-emerald-400/70">floorId</code>, and <code className="text-emerald-400/70">floorName</code></li>
        </ul>
        <p><strong>Bidirectional sync:</strong> The "Sync to CAD" action iterates rooms with a <code className="text-emerald-400/70">cadRoomId</code>, finds the matching floor/room in the CAD store, and calls <code className="text-emerald-400/70">updateWall</code> and <code className="text-emerald-400/70">updateOpening</code> to push Manual J edits back. Multi-floor support groups rooms by <code className="text-emerald-400/70">floorName</code> in the UI.</p>
      </div>
    ),
  },
  {
    id: 'pdf-export',
    title: 'PDF Export & Printing',
    icon: <FileText className="w-5 h-5 text-teal-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>Generate professional blueprint PDFs from your floor plan.</p>
        <StepList steps={[
          'Click the "Export PDF" button in the CAD workspace top bar',
          'The PDF includes your floor plan drawing, room schedules, and load summaries',
          'Customize what to include in Settings &gt; PDF &amp; Print Settings',
          'Choose page size (Letter, A4, Tabloid) and orientation (Landscape, Portrait)',
          'Add a custom watermark text',
        ]} />
        <p><strong>Firm stamps:</strong> Upload your PE seal or notary stamp in Settings &gt; Blueprint Stamps. The stamp is automatically placed on exported blueprints at your chosen corner position.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>PDF generation uses <strong>jsPDF</strong> with html2canvas for canvas rasterization. The <code className="text-emerald-400/70">pdfGenerator.ts</code> module reads preferences from <code className="text-emerald-400/70">usePreferencesStore</code>:</p>
        <ul className="list-disc list-inside text-sm text-slate-400 space-y-1">
          <li><code className="text-emerald-400/70">pdfPageSize</code>, <code className="text-emerald-400/70">pdfOrientation</code> — page dimensions</li>
          <li><code className="text-emerald-400/70">pdfInclude*</code> flags — toggle sections (drawing, room schedule, opening schedule, load summary, notes)</li>
          <li><code className="text-emerald-400/70">pdfWatermarkText</code> — diagonal watermark overlay</li>
          <li><code className="text-emerald-400/70">firmStampDataUrl</code>, <code className="text-emerald-400/70">firmStampPosition</code> — PE seal placement</li>
          <li><code className="text-emerald-400/70">notaryStampDataUrl</code> — notary seal</li>
        </ul>
        <p>Stamps are stored as base64 data URLs in localStorage (max 2MB per image). Position options: top-left, top-right, bottom-left, bottom-right.</p>
      </div>
    ),
  },
  {
    id: 'settings',
    title: 'Settings & Preferences',
    icon: <Settings className="w-5 h-5 text-slate-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>Customize DesignPro to work the way you want.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <SettingCard title="Appearance" desc="Theme (Midnight/Dark/Light), density, animations, tooltips" />
          <SettingCard title="Units" desc="Imperial (ft, °F) or Metric (m, °C) + default values" />
          <SettingCard title="CAD Workspace" desc="Grid snap, grid spacing, autosave toggle" />
          <SettingCard title="Accessibility" desc="High contrast, screen reader support, font scaling" />
          <SettingCard title="PDF & Print" desc="Page size, orientation, watermark, included sections" />
          <SettingCard title="Stamps" desc="Upload PE seal and notary stamp images" />
        </div>
        <Tip>Click "Reset All Preferences" at the bottom to restore defaults.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>All preferences live in <code className="text-emerald-400/70">usePreferencesStore</code> (Zustand), persisted to <code className="text-emerald-400/70">localStorage</code> under <code className="text-emerald-400/70">hvac_preferences</code>. The store applies theme, density, accent color, and animation preferences to the document root via CSS custom properties and class toggling.</p>
        <p>Theme classes (<code className="text-emerald-400/70">theme-midnight</code>, <code className="text-emerald-400/70">theme-dark</code>, <code className="text-emerald-400/70">theme-light</code>) and the <code className="text-emerald-400/70">reduce-motion</code> class are set on <code className="text-emerald-400/70">document.documentElement</code> in the <code className="text-emerald-400/70">applyTheme</code> function. Accent colors map to <code className="text-emerald-400/70">--accent-rgb</code> CSS var. Density scales via <code className="text-emerald-400/70">--density-scale</code>.</p>
      </div>
    ),
  },
  {
    id: 'mason',
    title: 'Mason AI Assistant',
    icon: <MessageSquarePlus className="w-5 h-5 text-emerald-400" />,
    easyContent: (
      <div className="space-y-3">
        <p><strong>Mason</strong> is your built-in HVAC engineering assistant. Look for the green chat icon in the bottom-left corner of the CAD workspace.</p>
        <StepList steps={[
          'Click the chat icon to open Mason',
          'Type any HVAC question — R-values, duct sizing, Manual J concepts, etc.',
          'Mason knows your project context and gives relevant answers',
          'Use the feedback button (speech bubble icon) to report bugs or suggest features',
          'Attach a screenshot to your feedback for extra clarity',
        ]} />
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Mason uses a keyword-matched knowledge base (<code className="text-emerald-400/70">KNOWLEDGE_BASE</code> array in Mason.tsx) with context-aware scoring. Queries are tokenized and matched against <code className="text-emerald-400/70">keywords</code> arrays, with a boost for entries whose <code className="text-emerald-400/70">contexts</code> array includes the current page context (<code className="text-emerald-400/70">'cad'</code> or <code className="text-emerald-400/70">'manualj'</code>).</p>
        <p>The feedback system stores submissions to <code className="text-emerald-400/70">localStorage</code> under <code className="text-emerald-400/70">hvac_feedback</code> with type (bug/suggestion/question), text, optional screenshot (base64 dataURL, max 5MB), and timestamp.</p>
      </div>
    ),
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: <Keyboard className="w-5 h-5 text-slate-400" />,
    easyContent: (
      <div className="space-y-1.5">
        <ShortcutRow keys="V" desc="Select tool" />
        <ShortcutRow keys="H" desc="Pan tool" />
        <ShortcutRow keys="W" desc="Draw Wall" />
        <ShortcutRow keys="D" desc="Dimension tool" />
        <ShortcutRow keys="L" desc="Label tool" />
        <ShortcutRow keys="R" desc="Detect Rooms" />
        <ShortcutRow keys="Delete" desc="Remove selected object" />
        <ShortcutRow keys="Ctrl+Z" desc="Undo" />
        <ShortcutRow keys="Ctrl+Y" desc="Redo" />
        <ShortcutRow keys="Ctrl+K" desc="Spotlight search" />
        <ShortcutRow keys="Escape" desc="Cancel / exit / close" />
        <ShortcutRow keys="Right-click" desc="End wall chain" />
        <ShortcutRow keys="Double-click" desc="Place final wall and finish" />
        <ShortcutRow keys="Scroll" desc="Zoom in / out" />
        <ShortcutRow keys="Middle drag" desc="Pan from any tool" />
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Keyboard shortcuts are handled in the <code className="text-emerald-400/70">useEffect</code> keydown listener in <code className="text-emerald-400/70">CadCanvas.tsx</code>. Tool switching sets <code className="text-emerald-400/70">activeTool</code> in the CAD store. Undo/redo use a per-floor history stack.</p>
        <div className="space-y-1.5">
          <ShortcutRow keys="V" desc="Select tool — sets activeTool: 'select'" />
          <ShortcutRow keys="H" desc="Pan tool — sets activeTool: 'pan'" />
          <ShortcutRow keys="W" desc="Wall tool — sets activeTool: 'draw_wall'" />
          <ShortcutRow keys="D" desc="Dimension — sets activeTool: 'dimension'" />
          <ShortcutRow keys="L" desc="Label — sets activeTool: 'label'" />
          <ShortcutRow keys="R" desc="Room detection — triggers detectRooms()" />
          <ShortcutRow keys="Delete/Backspace" desc="Dispatches remove* based on selection type" />
          <ShortcutRow keys="Ctrl+Z / Ctrl+Y" desc="Undo/redo via history stack" />
          <ShortcutRow keys="Ctrl+K" desc="Opens SpotlightSearch overlay" />
          <ShortcutRow keys="Escape" desc="Cancels active tool, exits 3D, closes modals" />
        </div>
      </div>
    ),
  },
  {
    id: 'manual-d',
    title: 'Manual D — Duct Design',
    icon: <GitBranch className="w-5 h-5 text-sky-400" />,
    easyContent: (
      <div className="space-y-4">
        <p>Manual D sizes every duct run based on your Manual J cooling loads. The calculator determines the correct duct diameter, velocity, and pressure drop for each room.</p>
        <div className="space-y-2">
          <p className="font-semibold text-white">Quick Start:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Run your Manual J calculation first</li>
            <li>Go to Manual D and click <strong>Import from Manual J</strong></li>
            <li>All 16 rooms (or however many) appear with proportional CFM values</li>
            <li>Set your blower ESP, filter drop, and coil drop from equipment specs</li>
            <li>Click <strong>Calculate Duct Sizing</strong></li>
          </ol>
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-white">What You Get:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Duct sizes</strong> — round diameter for each room run</li>
            <li><strong>Velocity</strong> — FPM with warnings if exceeding residential limits</li>
            <li><strong>Critical path</strong> — the longest run that sets your friction rate</li>
            <li><strong>System balance</strong> — whether dampers are needed</li>
          </ul>
        </div>
        <p className="text-sm text-slate-500">CFM per room = Equipment CFM × (Room Cooling BTU ÷ Total Cooling BTU). Equipment CFM = Recommended Tons × 400.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3 text-sm text-slate-400">
        <p>Manual D implements the <strong>Equal Friction Method</strong> per ACCA standards. The friction rate is derived from: Available SP ÷ (Critical Path TEL ÷ 100).</p>
        <p>Available SP = Blower ESP − Filter Drop − Coil Drop. Typical residential: 0.15–0.40 inwg.</p>
        <p>Each fitting (elbow, tee, takeoff, boot) adds equivalent length. TEL = actual length + sum of fitting ELs.</p>
        <p>The engine calculates round duct diameter from: D = √(4 × CFM / (π × Velocity)). Velocity is derived from the friction rate via Darcy-Weisbach approximation for the selected duct material.</p>
      </div>
    ),
  },
  {
    id: 'internal-loads',
    title: 'Internal Loads',
    icon: <Flame className="w-5 h-5 text-orange-400" />,
    easyContent: (
      <div className="space-y-4">
        <p>Internal loads account for every heat source inside a room — people, appliances, lighting, and anything else that produces heat.</p>
        <div className="space-y-2">
          <p className="font-semibold text-white">Room Type Presets:</p>
          <p>Select a room type (Kitchen, Bedroom, Fitness, Office, etc.) and the calculator auto-fills appropriate defaults for occupancy, appliances, and lighting.</p>
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-white">Activity Levels:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Sleeping</strong> — 200 sensible / 150 latent BTU/hr per person</li>
            <li><strong>Seated</strong> — 230 / 190 (default)</li>
            <li><strong>Light work</strong> — 300 / 300 (cooking, cleaning)</li>
            <li><strong>Moderate exercise</strong> — 500 / 500</li>
            <li><strong>Heavy exercise</strong> — 700 / 700</li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-white">Appliance Library (19 types):</p>
          <p>Gas range, refrigerator, dishwasher, dryer, computer, TV, server rack, hot tub, aquarium, grow lights, and more. Each has calibrated sensible + latent BTU values.</p>
        </div>
        <p className="text-sm text-slate-500"><strong>Miscellaneous Loads:</strong> Free-form sensible/latent BTU fields for anything not in the library — server rooms, aquaponics, industrial equipment.</p>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3 text-sm text-slate-400">
        <p>Internal gains are calculated per-room and added to the cooling sensible/latent subtotals. The breakdown appears in the PDF report under "Internal Load Breakdown."</p>
        <p>Values derived from ACCA Manual J Table 6 and ASHRAE Fundamentals. The engine replaces the old flat 1.0 BTU/sqft constant with: people (activity-scaled) + appliance sum + lighting (type-scaled) + miscellaneous.</p>
        <p>CAD-to-Manual-J bridge auto-guesses room type from name (e.g., "Kitchen and Dining" → kitchen preset with gas range, fridge, dishwasher).</p>
      </div>
    ),
  },
  {
    id: 'project-isolation',
    title: 'Project Management',
    icon: <FolderOpen className="w-5 h-5 text-emerald-400" />,
    easyContent: (
      <div className="space-y-4">
        <p>Every project keeps its calculations, duct designs, and CAD drawings completely separate. No cross-contamination when switching between projects.</p>
        <div className="space-y-2">
          <p className="font-semibold text-white">Project Context Bar:</p>
          <p>A bar at the top of Manual J and Manual D shows your active project name, type (Residential/Commercial), and a <strong>Switch</strong> dropdown to quickly change projects.</p>
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-white">Project Gate:</p>
          <p>When entering a calculator without an active project, a dialog asks you to select an existing project, create a new one, or continue in draft mode.</p>
        </div>
        <div className="space-y-2">
          <p className="font-semibold text-white">Session Persistence:</p>
          <p>Your workspace state saves automatically between sessions — panel positions, zoom level, toolbar state, and all data. When you return, everything is exactly where you left it.</p>
        </div>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3 text-sm text-slate-400">
        <p>Data is scoped to project IDs in localStorage: <code>hvac_manualj_inputs_&#123;projectId&#125;</code>, <code>hvac_manuald_inputs_&#123;projectId&#125;</code>, <code>hvac_cad_&#123;projectId&#125;</code>.</p>
        <p>Draft mode uses the key suffix <code>_draft</code>. One-time migration copies old global keys to draft scope on first load.</p>
        <p>CAD workspace state (panel visibility, zoom, ghosting) persists via the drawing serialization. The subscribe handler auto-saves on state changes with 500ms debounce.</p>
      </div>
    ),
  },
];

export default function UserGuidePage() {
  const [mode, setMode] = useState<GuideMode>('easy');
  const [expandedSection, setExpandedSection] = useState<string>('overview');

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 pt-8 pb-24 md:p-8 md:pt-12 md:pb-24">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30">
              <BookOpen className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold text-white">User Guide</h2>
          </div>
          <p className="text-slate-400 ml-14">Learn how to get the most out of HVAC DesignPro.</p>
        </header>

        {/* Mode Toggle */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex bg-slate-900/80 rounded-xl p-1 border border-slate-800/40">
            <button
              onClick={() => setMode('easy')}
              className={`flex items-center gap-2 py-2.5 px-5 rounded-lg text-sm font-bold transition-all ${mode === 'easy' ? 'bg-emerald-500/20 text-emerald-300 shadow-md border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <GraduationCap className="w-4 h-4" />
              Easy Mode
            </button>
            <button
              onClick={() => setMode('advanced')}
              className={`flex items-center gap-2 py-2.5 px-5 rounded-lg text-sm font-bold transition-all ${mode === 'advanced' ? 'bg-violet-500/20 text-violet-300 shadow-md border border-violet-500/30' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Zap className="w-4 h-4" />
              Advanced Mode
            </button>
          </div>
          <span className="text-xs text-slate-600">
            {mode === 'easy' ? 'Step-by-step instructions for getting started' : 'Technical details, store architecture, and internals'}
          </span>
        </div>

        {/* Sections */}
        <div className="space-y-3">
          {sections.map((section) => {
            const isExpanded = expandedSection === section.id;
            return (
              <section
                key={section.id}
                className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden"
              >
                <button
                  onClick={() => setExpandedSection(isExpanded ? '' : section.id)}
                  className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-800/20 transition-colors"
                >
                  {section.icon}
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex-1">{section.title}</h3>
                  <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 pt-2 border-t border-slate-800/40 text-sm text-slate-300 leading-relaxed animate-in slide-in-from-top-1 duration-200">
                    {mode === 'easy' ? section.easyContent : section.advancedContent}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-10 text-center">
          <p className="text-xs text-slate-600">
            HVAC DesignPro v1.0.0 — Need help? Open Mason in the CAD workspace or submit feedback.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
      <div className="flex items-center gap-2 mb-1 text-emerald-400">{icon}<span className="text-xs font-bold text-white">{title}</span></div>
      <p className="text-xs text-slate-500">{desc}</p>
    </div>
  );
}

function TechCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
      <p className="text-xs font-bold text-white uppercase tracking-wider mb-2">{title}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-400 flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-emerald-500/60 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span className="text-sm text-slate-300">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
      <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-emerald-300/80">{children}</p>
    </div>
  );
}

function ToolCard({ shortcut, name, desc }: { shortcut: string; name: string; desc: string }) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30">
      <kbd className="text-[10px] text-emerald-400 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono font-bold flex-shrink-0">
        {shortcut}
      </kbd>
      <div>
        <p className="text-xs font-semibold text-white">{name}</p>
        <p className="text-[10px] text-slate-500">{desc}</p>
      </div>
    </div>
  );
}

function LayerRow({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-slate-800/20">
      <div className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
      <span className="text-xs font-semibold text-white w-20">{name}</span>
      <span className="text-xs text-slate-500">{desc}</span>
    </div>
  );
}

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-950/40">
      <span className="text-xs text-slate-400">{desc}</span>
      <kbd className="text-[10px] text-emerald-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 font-mono font-bold">
        {keys}
      </kbd>
    </div>
  );
}

function SettingCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-3 rounded-xl bg-slate-800/20 border border-slate-700/30">
      <p className="text-xs font-bold text-white mb-0.5">{title}</p>
      <p className="text-[10px] text-slate-500">{desc}</p>
    </div>
  );
}
