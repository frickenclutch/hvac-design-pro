import { useState } from 'react';
import {
  BookOpen, ChevronRight, GraduationCap, Zap,
  Home, PenTool, Thermometer, Box, Layers, Building2,
  Keyboard, FileText, Settings, Compass,
  Eye, Lock,
  Printer, MessageSquarePlus,
  Wind, SquarePen, GitBranch, FolderOpen, Flame,
  Users, Globe, ShieldCheck, BadgeCheck, Share2, Mail,
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
  {
    id: 'team',
    title: 'Team & Members',
    icon: <Users className="w-5 h-5 text-emerald-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The <strong>Team page</strong> is where you manage who's in your organization. Open it from the sidebar — click <strong>Team</strong>.</p>
        <StepList steps={[
          'Members list shows everyone in your tenant — name, email, role, last seen',
          'Admins can change anyone\'s role using the dropdown next to their name',
          'Admins can remove a member with the red trash icon (you can\'t remove yourself)',
          'Use "Invite a member" to bring someone new in by email',
          'Pending invites appear below the form — copy the redemption link to send via your own email/chat',
        ]} />
        <div className="space-y-2">
          <p className="font-semibold text-white">Roles</p>
          <ul className="text-sm text-slate-300 space-y-1 ml-4 list-disc">
            <li><strong className="text-emerald-400">admin</strong> — full org control, can manage members + claim domain</li>
            <li><strong className="text-sky-400">engineer</strong> — create/edit projects, run calculations, share to community</li>
            <li><strong className="text-amber-400">tech</strong> — view projects, run calcs, download reports (no project creation)</li>
            <li><strong className="text-slate-400">viewer</strong> — read-only access</li>
          </ul>
        </div>
        <Tip>The platform won't let the last admin demote themselves. Promote someone else first if you want to change your own role.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Worker endpoints under <code className="text-emerald-400/70">/api/org/*</code>: <code>GET /team</code> (list members + invites + claimed domain), <code>POST /invite</code>, <code>DELETE /invites/:id</code>, <code>PATCH /users/:id</code> (role change), <code>DELETE /users/:id</code> (remove). All mutations require <code>role === 'admin'</code>.</p>
        <p>Email delivery is deferred to Phase 2 — invites are stored as token records with a 14-day expiration in the <code className="text-emerald-400/70">org_invites</code> table. The redemption link the admin copies points to <code>/onboarding?invite=&#123;token&#125;</code>.</p>
        <p>Last-admin demotion is enforced server-side — every tenant must always retain at least one user with <code>role='admin'</code> so the manage-team door stays open.</p>
      </div>
    ),
  },
  {
    id: 'domain-claim',
    title: 'Email Domain Claim',
    icon: <Mail className="w-5 h-5 text-violet-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>If your team all uses the same email domain (e.g. <code className="text-violet-400/70">@yourcompany.com</code>), you can <strong>claim it</strong> on the Team page. Once claimed, future signups at that domain auto-route to your tenant — you don't have to invite each person individually.</p>
        <StepList steps={[
          'Open Team in the sidebar',
          'Find the "Claimed email domain" card at the top',
          'Type your domain (without the @) and click Save',
          'Future @yourcompany.com signups land in your tenant automatically',
        ]} />
        <Tip>One domain per tenant. If someone else has already claimed it, you'll see a 409 error — contact your platform admin to resolve.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Stored in <code className="text-emerald-400/70">organisations.claimed_domain</code> (TEXT) and <code className="text-emerald-400/70">organisations.domain_verified_at</code> (TIMESTAMP). The verified-at field stays NULL until the Phase 2 DNS TXT verification flow lands — claiming today is on the honor system, but the column is in place so the verification flow doesn't require a schema migration.</p>
        <p>Conflict resolution is server-side — <code>PUT /api/org/domain</code> returns 409 if another tenant already owns the domain. Disputes resolved out-of-band by the L0 platform admin (Nathan @ c4tech.dev).</p>
      </div>
    ),
  },
  {
    id: 'community',
    title: 'Community Forum',
    icon: <Globe className="w-5 h-5 text-violet-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The <strong>Community page</strong> is a cross-tenant project board. Anyone with an account can browse projects others have shared, comment, and offer help. Most users will never need to share — but if you're stuck on a tricky job and want a second pair of eyes, the option is there.</p>
        <StepList steps={[
          'Click Community in the sidebar to see projects shared by other users',
          'Sort by Most recent, Oldest first, or Most commented',
          'Search by name, summary, climate zone, or standard',
          'Click a project card to read its summary and the comment thread',
          'Add a comment from the bottom of the detail page (max 5000 chars)',
          'Delete your own comments with the trash icon — soft-delete keeps the timeline intact',
        ]} />
        <Tip>You can comment on any public project, but you can't edit the project itself. Only the owner can update the calculations or share-summary.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>This is the one surface where strict per-tenant <code className="text-emerald-400/70">org_id</code> isolation is intentionally relaxed. Projects with <code>is_public = 1</code> are visible to any authenticated user via <code>/api/forum/projects</code>; the listing only exposes owner-curated fields (<code>name</code>, <code>share_summary</code>, <code>climate_zone</code>, <code>standard</code>) — never the raw address or client name.</p>
        <p>Comments live in the flat <code className="text-emerald-400/70">project_comments</code> table — no threading in v1. The author org_id is captured for L0 audit visibility, even though comments aren't org-scoped for read.</p>
        <p>Phase 2 backlog: comment threading (<code>parent_comment_id</code>), moderation tools (flag/report, platform-admin hide), email notifications to the project owner on new comments.</p>
      </div>
    ),
  },
  {
    id: 'share-project',
    title: 'Sharing a Project to Community',
    icon: <Share2 className="w-5 h-5 text-violet-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>Sharing a project posts it to the public Community board. You stay in control: only the summary you write is visible — your client name, exact address, and project notes never leave your tenant.</p>
        <StepList steps={[
          'On the Dashboard, hover the project card you want to share',
          'Click the small globe (🌐) icon next to the edit pencil',
          'Write a summary (≥ 20 chars) describing what you need help with',
          'Click "Share publicly" — your project is now visible on the Community page',
          'To withdraw sharing later, click the same icon and choose "Make private"',
        ]} />
        <Tip>You're the only one who can edit a shared project. Other users can only view + comment.</Tip>
        <Tip>Sharing currently requires the project to be saved to the cloud. If the project is local-only (no cloud icon), save it first.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Toggle endpoint: <code className="text-emerald-400/70">POST /api/forum/projects/:id/share</code> — body <code>&#123;isPublic, summary&#125;</code>. Only callable by the owning tenant's <code>admin</code> or <code>engineer</code>. Setting <code>isPublic=true</code> requires a non-empty summary (20-2000 chars).</p>
        <p>Stored fields: <code className="text-emerald-400/70">projects.is_public</code> (INTEGER), <code>projects.shared_at</code> (TIMESTAMP), <code>projects.share_summary</code> (TEXT). The summary is what the public listing shows; raw <code>address</code>, <code>client_name</code>, etc. are NEVER exposed via <code>/api/forum/*</code>.</p>
        <p>Withdrawing share sets <code>is_public = 0</code> but preserves <code>shared_at</code> and existing comments — re-sharing later picks up where it left off.</p>
      </div>
    ),
  },
  {
    id: 'manual-j-shadow',
    title: 'Cert-Grade Manual J Engine (Beta)',
    icon: <BadgeCheck className="w-5 h-5 text-amber-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>HVAC DesignPro is in the middle of upgrading its Manual J calculation engine to a <strong>cert-grade ACCA Manual J 8th Edition v2.50</strong> implementation. Submitted to ACCA on May 1, 2026 — currently awaiting review (~3-4 month SLA).</p>
        <p>Today, every Manual J calculation runs <strong>both engines</strong> in parallel:</p>
        <ul className="text-sm text-slate-300 space-y-1 ml-4 list-disc">
          <li><strong className="text-emerald-400">Legacy engine</strong> — the per-room aggregator that's been in production. Its results are what you see displayed.</li>
          <li><strong className="text-amber-400">Cert-grade engine v1.1.0</strong> — the new whole-house Form J1 implementation. Runs silently alongside legacy and logs drift to the browser console.</li>
        </ul>
        <p>Once we collect a few weeks of real-user drift telemetry from production projects, we flip the display to the cert-grade results. ACCA approval makes those outputs <strong>legally valid for permit applications</strong>.</p>
        <Tip>Nothing changes for you today. Same calculator, same display. Drift telemetry happens in the background.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Engine: <code className="text-emerald-400/70">frontend/src/engines/manualJ8/</code>, version stamp <code>manualJ8-ts-1.1.0</code>. Validated against ACCA reference test cases (Smith / Walker / Cobb) at 184/184 line items within 0.5% tolerance — 30/30 vitest pass.</p>
        <p>Adapter shim: <code className="text-emerald-400/70">manualJ8/adapters/legacy.ts → roomInputsToFormJ1Input()</code> aggregates per-room legacy <code>RoomInput[]</code> data into the whole-house <code>FormJ1Input</code>.</p>
        <p>Pipeline: <code className="text-emerald-400/70">runCalculation()</code> in <code>pages/ManualJCalculator.tsx</code> calls legacy first (display), then if <code>shadowRunManualJ8 === true</code> also calls the cert engine and console-logs <code>[engine drift]</code> with heat / sens / latent percentages.</p>
        <p>Phase 2 trigger criteria documented in <code>docs/option-e-ui-migration-plan.md</code>: ≥10 production projects driven through the calculator + drift on those projects ≤ 5% on every total + ACCA cert review approved.</p>
      </div>
    ),
  },
  {
    id: 'permits',
    title: 'Permits & Code Enforcement',
    icon: <ShieldCheck className="w-5 h-5 text-amber-400" />,
    easyContent: (
      <div className="space-y-3">
        <p>The <strong>Permits page</strong> is where projects move from "designed" to "approved." Two sides:</p>
        <div className="space-y-3">
          <div>
            <p className="font-semibold text-white mb-1">If you're submitting a project:</p>
            <StepList steps={[
              'On your Dashboard, hover the project card and click the shield icon',
              'Search for an authority — by ZIP, state, county, or type (Building Dept, Fire Marshal, etc.)',
              'Pick the authority. The card shows their additional intake process — site visit requirements, hard-copy needs, scheduling phone numbers, response timelines',
              'Pick a submission type (mechanical permit, plan review, inspection request, etc.) and write a cover letter',
              'Submit. Track status under Permits in the sidebar — submitted → under review → approved/denied/changes requested',
              'Withdraw any time before a decision lands',
            ]} />
          </div>
          <div>
            <p className="font-semibold text-white mb-1">If you're a permit authority (inspector, plan reviewer, code enforcement officer, etc.):</p>
            <StepList steps={[
              'Permits link in the sidebar takes you to your incoming queue',
              'Status counts up top: Submitted (in queue), Under Review (you started), Changes Requested, Approved, Denied, Withdrawn',
              'Click a submission to see the FULL project — calculations, drawings, address, cover letter (this is the deliberate cross-tenant exception)',
              'Claim it (marks as under review), then approve / deny / request changes',
              'Decision notes are required for deny + request changes (prevents silent denials)',
              'Optional: assign a permit number on approval',
              'Internal comments visible only to your authority side — separate from the public discussion thread the submitter sees',
            ]} />
          </div>
        </div>
        <Tip>The submitter sees your decision the moment you make it. They get the full discussion thread (minus internal comments) and any decision notes you write.</Tip>
        <Tip>Different jurisdictions use different terminology — Building Inspector, Code Enforcement Officer, Plan Reviewer, Permit Specialist. Configure your tenant's display title under Settings → Authority Profile.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Tenancy: authority status is the orthogonal flag <code className="text-emerald-400/70">users.is_permit_authority</code>, mirroring <code>is_platform_admin</code>. Authority profile fields live on <code>organisations</code>: <code>authority_type</code>, <code>authority_title</code>, <code>jurisdiction_states/counties/zips</code> (JSON arrays), <code>authority_intake_notes</code>, <code>authority_intake_email</code>. Migration <code>0005_permit_authority.sql</code>.</p>
        <p>Tables: <code className="text-emerald-400/70">permit_submissions</code> with state machine (submitted → under_review → approved | denied | changes_requested | withdrawn), and <code>permit_submission_comments</code> with an <code>is_internal</code> flag for authority-side notes.</p>
        <p>Cross-tenant exception: this is the SECOND deliberate exception to per-tenant <code>org_id</code> isolation (Community is the first). When a submission is created, both submitter org and authority org get scoped read access to the underlying project, drawings, and calculations. The Worker handler's <code>isParty()</code> check gates every read.</p>
        <p>Worker endpoints: <code>POST /api/permits/submit</code>, <code>GET /api/permits/submissions</code> (auto-scoped), <code>GET /api/permits/submissions/:id</code>, <code>PATCH /api/permits/submissions/:id</code> (decision actions), <code>POST /api/permits/submissions/:id/comments</code>, <code>GET /api/permits/authorities</code> (geographic search).</p>
        <p>Phase 2 backlog: customizable dashboard layouts for authority side, GIS polygon jurisdictions (today: ZIP arrays), email notifications, permit-certificate PDF generation, multi-authority routing (e.g., a project that needs both Mechanical + Fire approvals), inspection scheduling.</p>
      </div>
    ),
  },
  {
    id: 'platform-admin',
    title: 'Platform Admin Panel (L0)',
    icon: <ShieldCheck className="w-5 h-5 text-amber-400" />,
    easyContent: (
      <div className="space-y-3">
        <p className="text-sm text-slate-400 italic">Visible only to platform-level administrators (currently a single account at C4 Technologies).</p>
        <p>The <code>/admin</code> page is the cross-tenant control panel. It shows what's happening across <strong>every</strong> organization on the platform — orgs, users, projects, calculations, audit events.</p>
        <div className="space-y-2">
          <p className="font-semibold text-white">Sections:</p>
          <ul className="text-sm text-slate-300 space-y-1 ml-4 list-disc">
            <li><strong>Platform metrics</strong> — totals + last-30-day activity (orgs, users, projects, calcs, signups)</li>
            <li><strong>Q/A benchmarks</strong> — engine version distribution, calc volume + status mix, p50/p95/p99 duration vs SLO, audit activity, ACCA cert tile (184/184)</li>
            <li><strong>Organisations</strong> — full table; click a row for member roster + project counts</li>
            <li><strong>Audit feed</strong> — last 50 cross-org events</li>
            <li><strong>Action lab</strong> — placeholders for future destructive actions (impersonate, plan override, billing flips) — Phase 2+ work</li>
          </ul>
        </div>
        <Tip>Every section has a "Show raw JSON" drawer for ad-hoc inspection.</Tip>
      </div>
    ),
    advancedContent: (
      <div className="space-y-3">
        <p>Hard-gated route — <code className="text-emerald-400/70">isPlatformAdmin</code> flag on the user record (separate from <code>role</code>) controls visibility. Server enforces 403 on every <code>/api/platform/*</code> call via <code>requirePlatformAdmin</code> middleware in <code>workers/src/middleware/auth.ts</code>.</p>
        <p>Q/A benchmarks endpoint at <code>/api/platform/qa-benchmarks</code> joins live D1 telemetry (engine version distribution, calc volume + status mix, p50/p95/p99 via window-function CTE, audit activity) with static cert facts about the active engine version.</p>
        <p>Future: impersonation tokens, plan/seat overrides, <code>billing_status</code> flips — all queued behind ACCA cert completion. Audit log writes (SOC 2 CC7.2) still TODO.</p>
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
