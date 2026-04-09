import { useState } from 'react';
import {
  HelpCircle, X, SquarePen,
  Layers, Building2, Keyboard, ChevronRight,
  Save, Box,
} from 'lucide-react';

interface HelpSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: { title: string; desc: string }[];
}

const sections: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: <HelpCircle className="w-4 h-4" />,
    items: [
      {
        title: 'Canvas navigation',
        desc: 'Scroll to zoom in/out. Use the Pan tool (H) or hold middle mouse button to drag the canvas around. The dot grid represents 1-foot spacing at default scale.',
      },
      {
        title: 'Drawing your first wall',
        desc: 'Select the Wall tool (W) and click to start a wall. Move the cursor and click again to place it. Walls auto-chain — each new wall starts from the endpoint of the last. Double-click or right-click to finish the chain. Press ESC to cancel.',
      },
      {
        title: 'Selecting objects',
        desc: 'Switch to Select (V) to click on walls, openings, or HVAC units. Selected objects show their properties in the right panel where you can edit dimensions, materials, and thermal values.',
      },
    ],
  },
  {
    id: 'tools',
    title: 'Drawing Tools',
    icon: <SquarePen className="w-4 h-4" />,
    items: [
      {
        title: 'Select (V)',
        desc: 'Click objects to select them. View and edit properties in the right panel. Click empty space to deselect.',
      },
      {
        title: 'Pan (H)',
        desc: 'Click and drag to move the canvas. Also available by holding the middle mouse button from any tool.',
      },
      {
        title: 'Draw Wall (W)',
        desc: 'Click to set the start point, move and click again to place. Walls chain automatically — right-click or double-click to end the chain. Walls snap to the grid for precise alignment.',
      },
      {
        title: 'Add Window',
        desc: 'Click near a wall to place a window. The window snaps to the nearest wall automatically. Default size: 36"W x 48"H. Edit dimensions in the Properties panel after placing.',
      },
      {
        title: 'Add Door',
        desc: 'Click near a wall to place a door. Doors include a swing arc indicator. Default size: 32"W x 80"H with left swing. Edit in Properties after placing.',
      },
      {
        title: 'HVAC Unit',
        desc: 'Click anywhere to place a supply register. Edit the unit type (register, grille, air handler, condenser, thermostat), CFM rating, and label in the Properties panel.',
      },
      {
        title: 'Dimension (D)',
        desc: 'Click two points to measure the distance between them. A dimension label with the measurement in feet is placed at the midpoint. Great for annotating clearances and setbacks.',
      },
      {
        title: 'Label (L)',
        desc: 'Click to place a text label on the drawing. Useful for room names, notes, and callouts.',
      },
      {
        title: 'Detect Rooms (R)',
        desc: 'Click to automatically detect enclosed rooms from your wall layout. The algorithm finds closed wall loops and calculates area (sq ft) and perimeter for each room.',
      },
    ],
  },
  {
    id: '3d-view',
    title: '3D View Mode',
    icon: <Box className="w-4 h-4" />,
    items: [
      {
        title: 'Opening 3D View',
        desc: 'Click the "3D View" button in the top navigation bar to enter 3D mode. Your entire floor plan — walls, doors, windows, and HVAC units — renders as interactive 3D geometry.',
      },
      {
        title: 'Orbit (rotate)',
        desc: 'Click and drag (left mouse button) anywhere on the scene to orbit the camera around your building. The view rotates around the center of your model.',
      },
      {
        title: 'Pan (move)',
        desc: 'Right-click and drag to pan the camera sideways and vertically. This shifts your viewpoint without changing the angle.',
      },
      {
        title: 'Zoom',
        desc: 'Scroll the mouse wheel to zoom in and out. The zoom is smooth and dampened for a natural feel.',
      },
      {
        title: 'Hover inspection',
        desc: 'Move your mouse over any wall, door, window, or HVAC unit to see a tooltip with its properties — material, dimensions, R-value, CFM, and more.',
      },
      {
        title: 'Floor visibility',
        desc: 'Use the floor selector in the top-left corner to show or hide individual floors. Click "All Floors" to see the full multi-story stack.',
      },
      {
        title: 'Wireframe & Shadows',
        desc: 'Toggle wireframe mode (grid icon) to see through walls. Toggle shadows (sun icon) for lighting effects. Both controls are in the top-right corner.',
      },
      {
        title: 'Exiting 3D View',
        desc: 'Click the X button in the top-right corner or press Escape to return to the 2D canvas editor.',
      },
    ],
  },
  {
    id: 'floors',
    title: 'Multi-Floor System',
    icon: <Building2 className="w-4 h-4" />,
    items: [
      {
        title: 'Adding floors',
        desc: 'Use the floor bar below the top navigation to add new floors. Each floor has independent walls, openings, HVAC units, and annotations.',
      },
      {
        title: 'Switching floors',
        desc: 'Click a floor tab to switch to it. The active floor is highlighted in green. Other visible floors appear as faded dashed outlines for reference.',
      },
      {
        title: 'Floor controls',
        desc: 'Toggle the eye icon to show/hide a floor\'s ghost outline. Use the lock icon to prevent edits. Click the floor name to rename it. Set custom ceiling heights per floor.',
      },
    ],
  },
  {
    id: 'layers',
    title: 'Layers',
    icon: <Layers className="w-4 h-4" />,
    items: [
      {
        title: 'Layer types',
        desc: 'Five layers control visibility: Walls (green), Openings (blue), HVAC (purple), Annotations (amber), and Underlay (gray). Toggle the eye icon to show/hide each layer.',
      },
      {
        title: 'Locking layers',
        desc: 'Lock a layer to prevent selecting or editing objects on it. Useful when you want to draw HVAC over walls without accidentally moving the walls.',
      },
      {
        title: 'Opacity',
        desc: 'Adjust layer opacity with the slider to fade objects in the background while focusing on a specific layer.',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: <Keyboard className="w-4 h-4" />,
    items: [
      { title: 'V', desc: 'Select tool' },
      { title: 'H', desc: 'Pan tool' },
      { title: 'W', desc: 'Draw Wall tool' },
      { title: 'D', desc: 'Dimension tool' },
      { title: 'L', desc: 'Label tool' },
      { title: 'R', desc: 'Detect Rooms' },
      { title: 'Ctrl + Z', desc: 'Undo last action' },
      { title: 'Ctrl + Y', desc: 'Redo last action' },
      { title: 'Delete', desc: 'Remove selected wall' },
      { title: 'Ctrl + K', desc: 'Search all assets' },
      { title: 'ESC', desc: 'Cancel tool / exit 3D View / close dialogs' },
      { title: 'Right-click', desc: 'End wall chain / cancel placement' },
      { title: 'Double-click', desc: 'Place final wall segment and finish chain' },
      { title: 'Scroll wheel', desc: 'Zoom in / out' },
      { title: 'Middle mouse drag', desc: 'Pan canvas from any tool' },
    ],
  },
  {
    id: 'properties',
    title: 'Properties & Saving',
    icon: <Save className="w-4 h-4" />,
    items: [
      {
        title: 'Wall properties',
        desc: 'Select a wall to edit its thickness, R-value, and material (Insulated Wood Stud, CMU Block, or Poured Concrete). U-Factor is auto-computed from R-value.',
      },
      {
        title: 'Opening properties',
        desc: 'Select a window or door to view/edit width, height, U-Factor, SHGC (windows), and swing direction (doors).',
      },
      {
        title: 'HVAC properties',
        desc: 'Select an HVAC unit to change its type, label, and CFM rating. Supported types: Supply Register, Return Grille, Air Handler, Condenser, Thermostat, Duct Run.',
      },
      {
        title: 'Auto-save',
        desc: 'Your drawing saves automatically to local storage every 3 seconds when changes are detected. The save status is shown in the top navigation bar (Draft, Unsaved, Saving, Saved).',
      },
      {
        title: 'Undo & Redo',
        desc: 'Use Ctrl+Z to undo and Ctrl+Y to redo. The undo/redo buttons in the top bar also work. History is tracked per floor.',
      },
    ],
  },
];

export default function HelpCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [expandedSection, setExpandedSection] = useState<string | null>('getting-started');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-auto" onClick={onClose}>
    <div className="w-[420px] max-h-[80vh] glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/80 overflow-hidden animate-in zoom-in-95 fade-in duration-200" onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">Help Center</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sections.map((section) => {
          const isExpanded = expandedSection === section.id;
          const isShortcuts = section.id === 'shortcuts';

          return (
            <div key={section.id} className="border-b border-slate-800/50 last:border-0">
              <button
                onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              >
                <span className="text-emerald-400">{section.icon}</span>
                <span className="text-sm font-semibold text-slate-200 flex-1">{section.title}</span>
                <ChevronRight
                  className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                />
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 space-y-2 animate-in slide-in-from-top-1 duration-200">
                  {section.items.map((item, i) => (
                    <div key={i} className={`${isShortcuts ? 'flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-950/40' : 'pl-3 border-l-2 border-slate-800 py-1.5'}`}>
                      {isShortcuts ? (
                        <>
                          <span className="text-xs text-slate-400">{item.desc}</span>
                          <kbd className="text-[10px] text-emerald-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 font-mono font-bold">
                            {item.title}
                          </kbd>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-slate-300 mb-0.5">{item.title}</p>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{item.desc}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/50 flex-shrink-0">
        <p className="text-[10px] text-slate-600 text-center font-medium">
          HVAC DesignPro CAD Workspace — Press <kbd className="text-emerald-500/70 font-mono">ESC</kbd> to return to Select at any time
        </p>
      </div>
    </div>
    </div>
  );
}
