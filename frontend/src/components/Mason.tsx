import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Zap, Thermometer, Wind, Calculator, Phone, Command, MessageSquarePlus, Camera, Check, ArrowLeft, Paperclip, Trash2, AlertTriangle } from 'lucide-react';
import { useProjectStore } from '../stores/useProjectStore';
import { useCadStore } from '../features/cad/store/useCadStore';
import { useAuthStore } from '../features/auth/store/useAuthStore';
import { api } from '../lib/api';

// ── Mason — your AI HVAC engineering assistant ───────────────────────────────
// Named after the masons who've built the world's buildings, brick by brick.
// Unified across CAD workspace and Manual J Calculator.

// ── Context mode determines which knowledge is prioritized ─────────────────────
export type MasonContext = 'cad' | 'manualj' | 'manual-d';

// ── Knowledge base ─────────────────────────────────────────────────────────────
interface KBEntry {
  keywords: string[];
  contexts: MasonContext[];
  answer: string;
}

const KNOWLEDGE_BASE: KBEntry[] = [
  // ── Manual J specific ──────────────────────────────────────────────────────
  {
    keywords: ['manual j', 'load calculation', 'heat load', 'cooling load', 'what is manual j'],
    contexts: ['manualj', 'cad'],
    answer: `Great question! **Manual J** is the industry standard (from ACCA) for calculating how much heating and cooling a building actually needs.

It looks at four main things:
- **Building envelope** — your walls, roof, and floor (R-values matter here)
- **Windows & doors** — U-factor and solar heat gain (SHGC)
- **Climate** — outdoor design temperatures for your specific location
- **Infiltration** — how much outside air leaks in

The calculator on this platform walks you through it room by room. Each room gets its own heating and cooling load, then they add up to your whole-house total.`,
  },
  {
    keywords: ['measure', 'how to measure', 'room size', 'square feet', 'sq ft', 'area', 'floor area', 'dimensions'],
    contexts: ['manualj', 'cad'],
    answer: `**How to Measure Your Rooms**

Grab a tape measure and follow these steps:

1. **Length & Width** — Measure wall-to-wall at floor level (inside dimensions). For the calculator, enter in feet.

2. **Ceiling Height** — Measure floor to ceiling. Standard is 8 or 9 ft.

3. **Odd shapes** — Break the room into rectangles:
   - L-shaped room = two rectangles added together
   - Room with a bump-out = main rectangle + bump-out rectangle

4. **Quick trick** — If you know the total sq ft from a floor plan or listing, just enter length × width that equals that area (e.g., 15 × 13 = 195 sq ft).

**Don't have a tape measure?** Count floor tiles (usually 12" each), pace it off (~2.5 ft per step), or check your home's floor plan.`,
  },
  {
    keywords: ['window area', 'glass area', 'window size', 'how big', 'fenestration', 'window measurement'],
    contexts: ['manualj'],
    answer: `**Measuring Windows for Manual J**

What you need for each room:
- **Window area in sq ft** — Width × Height of the glass (not the frame)
- **Direction it faces** — N, S, E, or W (this affects solar gain)

**Common window sizes:**
| Window Type | Rough Size | Glass Area |
|---|---|---|
| Small bathroom | 2' × 3' | ~5 sq ft |
| Standard bedroom | 3' × 4' | ~10 sq ft |
| Large living room | 5' × 4' | ~18 sq ft |
| Sliding glass door | 6' × 7' | ~35 sq ft |
| Picture window | 6' × 5' | ~25 sq ft |

**Tip:** For multiple windows on the same wall, add their areas together. A bedroom with two 3'×4' windows facing south = 20 sq ft of south-facing glass.`,
  },
  {
    keywords: ['outdoor temp', 'design temp', 'outdoor heating', 'outdoor cooling', 'what temperature', 'climate', 'weather'],
    contexts: ['manualj', 'cad'],
    answer: `**Design Temperatures — What to Enter**

These are NOT average temps. They're the "worst case" temps your system needs to handle (ASHRAE 99%/1% values).

**Find yours:** Look up your city below or search "ASHRAE design temperature [your city]"

| City | Winter (Heating) | Summer (Cooling) |
|---|---|---|
| Phoenix, AZ | 38°F | 109°F |
| Los Angeles, CA | 41°F | 93°F |
| Miami, FL | 47°F | 92°F |
| Atlanta, GA | 21°F | 94°F |
| Chicago, IL | -3°F | 93°F |
| Boston, MA | 6°F | 91°F |
| Minneapolis, MN | -12°F | 91°F |
| New York, NY | 11°F | 93°F |
| Dallas, TX | 19°F | 102°F |
| Seattle, WA | 26°F | 88°F |
| Denver, CO | 1°F | 93°F |

**Indoor defaults:** 70°F heating / 75°F cooling (ACCA standard). You usually don't need to change these.`,
  },
  {
    keywords: ['r-value', 'r value', 'insulation', 'wall insulation', 'thermal resistance', 'what r value'],
    contexts: ['manualj', 'cad'],
    answer: `**R-Value — What's In Your Walls?**

R-value = how well something resists heat flow. Higher = better insulation.

**How to figure out your R-value:**
- **Know your wall type** — look in the attic or an outlet box to see stud size
- **2×4 studs** (3.5" cavity) = R-13 to R-15 with fiberglass batts
- **2×6 studs** (5.5" cavity) = R-19 to R-21
- **No insulation visible?** Use R-4 for the wall assembly

| Assembly | R-Value |
|---|---|
| 2×4 stud, fiberglass | R-13 |
| 2×4 stud, spray foam | R-14 to R-28 |
| 2×6 stud, fiberglass | R-19 |
| 2×6 stud, spray foam | R-21 to R-38 |
| CMU block (empty) | R-2 |
| Poured concrete 8" | R-1.35 |
| Attic (code min) | R-38 to R-60 |

**U-Factor** = 1 / R-Value (the calculator does this math for you)`,
  },
  {
    keywords: ['u-factor', 'u factor', 'window type', 'glass', 'glazing', 'shgc', 'low-e', 'low e', 'double pane', 'single pane'],
    contexts: ['manualj', 'cad'],
    answer: `**Window Performance — U-Factor & SHGC**

| Window Type | U-Factor | SHGC |
|---|---|---|
| Single pane clear | 1.04 | 0.86 |
| Double pane clear | 0.47 | 0.56 |
| Double pane Low-E | 0.30 | 0.25-0.40 |
| Triple pane Low-E | 0.18 | 0.22-0.35 |

**How to tell what you have:**
- **Single pane** — hold a flame to the glass, you see one reflection
- **Double pane** — two reflections, slight gap between them
- **Low-E** — double pane with a faint tint (coating reflects heat)

**SHGC** = how much solar heat gets through (0 = none, 1 = all)
- Hot climate? Lower SHGC (0.25) keeps heat out
- Cold climate? Higher SHGC (0.40+) lets free solar heat in`,
  },
  {
    keywords: ['infiltration', 'air leakage', 'ach', 'blower door', 'drafty', 'draft', 'construction quality'],
    contexts: ['manualj', 'cad'],
    answer: `**Construction Quality & Air Leakage**

This affects how much outside air sneaks in. Pick the one that matches:

**Tight** — Built after 2010, spray foam, house wrap, sealed ducts
- ACH: 0.2 - 0.35

**Average** — 1980s-2000s, fiberglass batts, decent weatherstripping
- ACH: 0.35 - 0.5

**Loose** — Pre-1980, minimal insulation, you can feel drafts
- ACH: 0.5 - 1.0+

**Quick test:** On a cold windy day, hold your hand near outlets on exterior walls. Feel a draft? That's infiltration.

**If you've had a blower door test:** Use that number. ACH50 < 3.0 is pretty tight, < 1.0 is passive house territory.`,
  },
  {
    keywords: ['duct', 'duct location', 'attic duct', 'crawl space', 'unconditioned', 'duct loss'],
    contexts: ['manualj'],
    answer: `**Duct Location — Why It Matters**

Where your ducts run affects efficiency. Ducts in hot attics or cold crawl spaces lose energy.

| Location | Duct Loss |
|---|---|
| **Conditioned space** | ~0% loss (best) |
| **Insulated attic** | ~15-20% loss |
| **Uninsulated attic** | ~25-35% loss |
| **Crawl space** | ~15-25% loss |
| **Garage** | ~20-30% loss |

**What to pick in the calculator:**
- Ducts inside walls/floors/between conditioned rooms → **Conditioned**
- Ducts in an insulated attic with duct insulation → **Attic**
- Ducts in a vented crawl → **Crawl space**

The calculator adds duct loss to your loads automatically.`,
  },
  {
    keywords: ['daily range', 'temperature swing', 'diurnal'],
    contexts: ['manualj'],
    answer: `**Cooling Daily Range**

This is the difference between the high and low temperature on a typical summer day.

| Range | Difference | Example Cities |
|---|---|---|
| **Low** | < 15°F | Miami, Houston, coastal areas |
| **Medium** | 15-25°F | Atlanta, St. Louis, most suburbs |
| **High** | > 25°F | Phoenix, Denver, Las Vegas |

**Why it matters:** A high daily range means the evening cools down significantly. Manual J gives you credit for this because your house stores heat in the walls (thermal mass) and releases it when it cools down.

Dry, inland, desert = High range. Humid, coastal = Low range.`,
  },
  {
    keywords: ['grains', 'moisture', 'humidity', 'latent', 'indoor grains', 'outdoor grains'],
    contexts: ['manualj'],
    answer: `**Moisture Grains — Humidity Inputs**

Grains measure moisture in the air (7,000 grains = 1 lb of water).

**Outdoor grains** (summer design):
| Climate | Grains |
|---|---|
| Dry (Phoenix, Denver) | 40-60 |
| Moderate (Chicago, NYC) | 80-100 |
| Humid (Miami, Houston) | 110-130 |

**Indoor grains:** Usually 50-55 gr/lb (matches ~50% RH at 75°F)

**Why it matters:** The difference (outdoor - indoor) determines your **latent cooling load** — the energy needed to dehumidify, not just cool. High humidity areas need more latent capacity.

If you're unsure, the defaults (105 outdoor / 53 indoor) work for most moderate-humid climates.`,
  },
  {
    keywords: ['result', 'btu', 'tonnage', 'tons', 'equipment', 'what size', 'sizing', 'how many tons'],
    contexts: ['manualj', 'cad'],
    answer: `**Reading Your Results — Equipment Sizing**

After running the calculation:

- **Total Heating BTU/hr** — Size your furnace to match this (don't oversize more than 40%)
- **Total Cooling BTU/hr** — Size your AC/heat pump to match

**1 ton = 12,000 BTU/hr of cooling**

| Total Cooling BTU/hr | Tons Needed |
|---|---|
| 18,000 | 1.5 |
| 24,000 | 2.0 |
| 30,000 | 2.5 |
| 36,000 | 3.0 |
| 42,000 | 3.5 |
| 48,000 | 4.0 |
| 60,000 | 5.0 |

**Golden rule:** Pick the size that's closest to your load, rounding down slightly. Oversizing wastes money, short cycles, and dehumidifies poorly.`,
  },
  {
    keywords: ['cfm', 'airflow', 'duct size', 'air flow', 'supply'],
    contexts: ['manualj', 'cad'],
    answer: `**CFM & Duct Sizing (Manual D)**

**Rules of thumb:**
- ~400 CFM per ton of cooling
- ~1 CFM per sq ft for residential

**Duct sizing by CFM:**
| CFM | Round Duct | Rectangular |
|---|---|---|
| 100 | 6" | 8×6 |
| 200 | 8" | 10×8 |
| 400 | 10" | 12×10 |
| 600 | 12" | 14×10 |
| 800 | 14" | 16×12 |

**Velocity limits:** 600-900 FPM for residential trunks, 400-600 FPM for branches.`,
  },
  // ── CAD — Getting Started & Navigation ─────────────────────────────────────
  {
    keywords: ['getting started', 'how to start', 'begin', 'new to', 'tutorial', 'walkthrough', 'guide'],
    contexts: ['cad'],
    answer: `**Getting Started with HVAC DesignPro CAD**

Here's how to build a floor plan from scratch:

1. **Navigate** — Scroll to zoom, middle-mouse or Pan tool (**H**) to drag the canvas
2. **Draw walls** — Press **W**, click to start, click to place. Double-click to finish. Walls chain automatically
3. **Add openings** — Select Window or Door tool, click near a wall — it snaps into place
4. **Place HVAC** — Select the HVAC tool, click anywhere to drop a register/grille/equipment
5. **Detect rooms** — Press **R** to auto-detect enclosed rooms from your walls
6. **Add labels** — Press **L** to place text annotations

**Pro tips:**
- The dot grid = 1-foot spacing at default scale
- Click objects with Select (**V**) to edit properties in the right panel
- Use **Ctrl+Z** to undo, **Ctrl+K** to search all assets
- Everything auto-saves every 3 seconds`,
  },
  {
    keywords: ['navigate', 'canvas', 'pan', 'zoom', 'move around', 'scroll', 'grid', 'select', 'selection'],
    contexts: ['cad'],
    answer: `**Canvas Navigation & Selection**

**Moving around:**
- **Zoom** — Scroll wheel to zoom in/out
- **Pan** — Press **H** for Pan tool, or hold middle mouse button from any tool
- The dot grid represents **1-foot spacing** at default scale

**Selecting objects:**
- Press **V** for Select tool (or click the arrow icon)
- Click on walls, openings, HVAC units, labels, or underlays
- Selected objects show their **properties in the right panel** — edit dimensions, materials, R-values, colors, etc.
- Click empty canvas space to deselect
- Press **Delete** to remove the selected object`,
  },
  {
    keywords: ['keyboard', 'shortcut', 'hotkey', 'key', 'keys', 'commands'],
    contexts: ['cad'],
    answer: `**Keyboard Shortcuts**

| Key | Action |
|---|---|
| **V** | Select tool |
| **H** | Pan tool |
| **W** | Draw Wall tool |
| **D** | Dimension tool |
| **L** | Label tool |
| **R** | Detect Rooms |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Ctrl+K** | Search all assets |
| **Delete** | Remove selected object |
| **ESC** | Cancel tool / exit 3D / close dialogs |
| **Right-click** | End wall chain / cancel placement |
| **Double-click** | Place final wall and finish chain |
| **Scroll wheel** | Zoom in/out |
| **Middle mouse** | Pan from any tool |`,
  },
  {
    keywords: ['save', 'auto save', 'autosave', 'undo', 'redo', 'history'],
    contexts: ['cad'],
    answer: `**Auto-Save & Undo/Redo**

**Auto-save:** Your drawing saves automatically to local storage **every 3 seconds** when changes are detected. Watch the status badge in the top nav:
- **Draft** — no changes yet
- **Unsaved** — changes detected, save pending
- **Saving...** — write in progress
- **Saved** — all changes persisted

**Undo/Redo:**
- **Ctrl+Z** to undo, **Ctrl+Y** to redo
- Or click the undo/redo buttons in the center toolbar
- History is tracked **per floor**`,
  },
  {
    keywords: ['dimension', 'measure', 'distance', 'clearance', 'setback', 'ruler', 'measuring'],
    contexts: ['cad'],
    answer: `**Dimension Tool (D)**

1. Press **D** or click the Dimension tool
2. Click a start point, then click an end point
3. A measurement label (in feet) appears at the midpoint

Great for annotating clearances, setbacks, room widths, and equipment spacing. Dimensions live on the **Annotations** layer — toggle visibility in the Layer Manager.`,
  },
  {
    keywords: ['appearance', 'customize', 'color', 'theme', 'background', 'wall color', 'accessibility', 'settings'],
    contexts: ['cad'],
    answer: `**Appearance & Customization**

Scroll down in the **Properties panel** (right side, when nothing is selected) to find the **Appearance** section:

- **Canvas Background** — preset color swatches (dark, light, blueprint, warm) or custom color picker
- **Wall Color** — change the color of all walls on the canvas
- **Window / Door Color** — change the color of all openings

Each option has **8 preset swatches** plus a custom color picker. Changes apply instantly and persist with your project.`,
  },
  {
    keywords: ['wall', 'draw wall', 'building', 'floor plan', 'how to draw'],
    contexts: ['cad'],
    answer: `**Drawing Walls**

1. Press **W** or click the Wall tool
2. Click to start — move and click to place
3. Walls chain automatically from the last endpoint
4. **Double-click** or **right-click** to end the chain
5. **ESC** to cancel

**Tips:**
- Walls snap to a 1-foot grid
- Close a room by clicking back on the starting point
- Select a wall to edit R-value, thickness, and material
- Use the floor system for multi-story buildings`,
  },
  {
    keywords: ['window placement', 'door placement', 'add window', 'add door', 'opening'],
    contexts: ['cad'],
    answer: `**Placing Windows & Doors**

1. Select the **Window** or **Door** tool from the toolbox
2. Click near any wall — the opening snaps to the nearest wall
3. The tool auto-returns to Select after placing

**Defaults:**
- Windows: 36"W × 48"H, U-Factor 0.30, SHGC 0.25
- Doors: 32"W × 80"H, left swing

Select the placed opening to edit dimensions and thermal properties in the right panel.

**Door Controls:**
- **Swing Direction** — toggle Left / Right / Double with one click
- **Quick Size Presets** — tap a preset chip to instantly resize:
  - 24×80 (closet), 30×80 (interior), 32×80 (standard)
  - 36×80 (wide/ADA), 48×80 (double), 72×80 (sliding patio)`,
  },
  {
    keywords: ['hvac', 'place hvac', 'register', 'supply', 'return', 'unit'],
    contexts: ['cad'],
    answer: `**Placing HVAC Units**

1. Click the **HVAC** tool (green icon with wind symbol)
2. Click anywhere on the canvas to place
3. Auto-returns to Select after placing

**Unit types** (edit in Properties after placing):
- Supply Register — delivers conditioned air
- Return Grille — pulls air back to the handler
- Air Handler — indoor fan/coil unit
- Condenser — outdoor compressor unit
- Thermostat — wall-mounted control
- Duct Run — represents a duct section

Edit CFM, label, and type in the right panel.`,
  },
  {
    keywords: ['room detect', 'detect room', 'detect rooms', 'find rooms', 'auto detect'],
    contexts: ['cad'],
    answer: `**Auto Room Detection**

1. Draw walls to form enclosed spaces (rooms need at least 3 walls)
2. Click the **Detect Rooms** tool or press **R**
3. Click anywhere on the canvas

The algorithm:
- Finds all closed wall loops
- Calculates area (sq ft) and perimeter
- Labels each room at its centroid

Use detected room areas directly in the Manual J Calculator for accurate load calculations.`,
  },
  {
    keywords: ['layer', 'layers', 'visibility', 'hide', 'show'],
    contexts: ['cad'],
    answer: `**Layer Controls**

5 layers control what's visible:
- **Walls** (green) — structural walls
- **Openings** (blue) — windows and doors
- **HVAC** (purple) — registers, grilles, equipment
- **Annotations** (amber) — dimensions and labels
- **Underlay** (gray) — reference images

Toggle the eye icon to show/hide. Lock icon prevents edits. Opacity slider fades layers.`,
  },
  {
    keywords: ['floor', 'multi floor', 'multi-floor', 'story', 'stories', 'multi story'],
    contexts: ['cad'],
    answer: `**Multi-Floor System**

- Click **+** in the floor bar to add a new floor
- Each floor has its own walls, openings, HVAC, and annotations
- Other visible floors appear as **faded dashed outlines** for reference
- Toggle the eye icon to show/hide ghost outlines
- Lock icon prevents edits to that floor
- Click the floor name to rename it
- Set custom ceiling heights per floor`,
  },
  {
    keywords: ['3d', 'three d', '3d view', '3d model', 'render', 'orbit', 'rotate building', 'three dimensional'],
    contexts: ['cad'],
    answer: `**3D View**

Click the **3D View** button in the top toolbar to launch a full 3D render of your floor plan.

**What you see:**
- Walls extruded to their actual height and thickness
- Windows as transparent blue glass panels
- Doors as orange panels with wooden frames
- HVAC units as colored 3D shapes (cyan registers, purple grilles, pink air handlers, orange condensers)
- Floor planes colored by detected room

**Controls:**
- **Orbit** — click and drag to rotate around the building
- **Pan** — right-click drag to slide the view
- **Zoom** — scroll wheel to zoom in/out
- **Reset View** — bottom button snaps back to the default angle

**Toolbar (top-right):**
- **Grid toggle** — wireframe mode to see through walls
- **Sun toggle** — enable/disable shadows and lighting
- **X** — close and return to 2D (or press **Escape**)

**Floor selector (top-left):**
- View all floors stacked or isolate individual floors

All your walls, openings, and HVAC units render automatically from the 2D drawing data.`,
  },
  {
    keywords: ['search', 'find', 'ctrl k', 'locate', 'asset', 'discover'],
    contexts: ['cad'],
    answer: `**Asset Search (Ctrl+K)**

Press **Ctrl+K** (or Cmd+K on Mac) or click the **Search** icon to open the global asset finder.

**What it searches:**
- Walls — by material, R-value, thickness
- Windows & Doors — by type, dimensions, U-factor
- HVAC Units — by type, label, CFM
- Rooms — by name and area
- Labels — by text content
- Underlays — by filename

**How to use:**
1. Start typing to filter results instantly
2. Use **arrow keys** to navigate results
3. Press **Enter** to select — the canvas pans to that object and highlights it
4. The correct floor is automatically activated if the object is on a different floor

**Tip:** Search for "R-19" to find all R-19 walls, or "supply" to find all supply registers.`,
  },
  {
    keywords: ['label', 'text', 'annotation', 'add text', 'font', 'type text', 'write'],
    contexts: ['cad'],
    answer: `**Labels & Text Annotations**

1. Press **L** or click the **Label** tool
2. Click on the canvas — a text input appears at that spot
3. Type your text and press **Enter** to place (or **Escape** to cancel)
4. If you press Enter without typing, it defaults to "Label"

**Customization (select a placed label):**
The Properties panel on the right gives you full control:
- **Font Family** — Arial, Helvetica, Times, Courier, Georgia, Verdana, Monospace
- **Font Size** — 8px to 72px
- **Color** — preset swatches (white, green, amber, blue, red, gray) or custom color picker
- **Bold / Italic** — toggle buttons
- **Text Alignment** — Left, Center, Right
- **Background Color** — optional colored background behind text
- **Scale** — X and Y scaling for stretching
- **Rotation** — any angle in degrees`,
  },
  {
    keywords: ['import', 'upload', 'drag', 'drop', 'image', 'underlay', 'trace', 'blueprint', 'plan image'],
    contexts: ['cad'],
    answer: `**Importing Images (Underlay)**

Two ways to import:
1. **Drag & drop** — drag a PNG, JPG, or SVG file directly onto the canvas
2. **Import button** — click **Import Image** at the bottom of the left toolbox

**Supported formats:** PNG, JPG, GIF, WebP, SVG

**After importing:**
- The image appears centered on the canvas, auto-scaled proportionally
- It lives on the **Underlay layer** (locked by default for tracing)
- Adjust opacity using the Underlay layer slider in the Layer Manager
- To move/resize: **unlock the Underlay layer** first, then select and drag

**Properties (when selected):**
- Width & Height with aspect ratio lock
- Rotation and opacity controls
- Delete button

**Tip:** Import a scanned floor plan, set Underlay opacity to 30%, lock the layer, and trace over it with the Wall tool.`,
  },
  {
    keywords: ['export', 'pdf', 'print', 'plot', 'document', 'report'],
    contexts: ['cad'],
    answer: `**PDF Export**

Click **Export PDF** in the top toolbar to generate a multi-page engineering document:

**Page 1 — Drawing Plot**
- Your canvas drawing at high resolution
- Title block with firm, project, engineer, date
- North arrow, scale indicator, PE seal placeholder
- Revision block

**Page 2 — Room & Wall Schedules**
- Table of all detected rooms with areas and perimeters
- Table of all walls with lengths, R-values, and materials

**Page 3 — Opening & HVAC Schedules**
- Window/door schedule with dimensions and thermal properties
- HVAC equipment schedule with CFM totals

**Page 4 — Load Summary** (if Manual J data available)
- Design conditions and total heating/cooling loads

**Page 5 — General Notes**
- Standard engineering disclaimers and code references`,
  },

  // ── Manual D specific ──────────────────────────────────────────────────────
  {
    keywords: ['manual d', 'duct sizing', 'duct design', 'duct calculator', 'what is manual d'],
    contexts: ['manual-d', 'manualj', 'cad'],
    answer: `**Manual D** is the ACCA standard for residential duct design and sizing.

It determines the correct duct sizes for every room based on:
- **Required CFM** per room (from your Manual J cooling loads)
- **Available static pressure** (blower ESP minus filter/coil drops)
- **Friction rate** (pressure loss per 100 ft of duct)
- **Duct material** (sheet metal, flex, spiral, etc.)

The goal: deliver the right amount of air to every room without excessive noise or pressure loss.

**Quick start:** Run your Manual J calculation first, then click **Import from Manual J** in Manual D to auto-populate all rooms with proportional CFM values.`,
  },
  {
    keywords: ['friction rate', 'friction', 'pressure loss', 'inwg per 100'],
    contexts: ['manual-d'],
    answer: `**Friction Rate** is the pressure drop per 100 feet of straight duct, measured in inwg/100ft.

It's calculated from your available static pressure divided by the critical path length:
\`Friction Rate = Available SP / (Critical Path TEL / 100)\`

**Available SP** = Blower ESP − Filter Drop − Coil Drop

Typical residential values:
- **0.08–0.12 inwg/100ft** — generous, quiet system
- **0.12–0.20 inwg/100ft** — standard residential
- **0.20–0.30 inwg/100ft** — tight, may be noisy

Lower friction rates = larger ducts = quieter operation. Higher rates = smaller ducts = more noise risk.`,
  },
  {
    keywords: ['equal friction', 'design method', 'sizing method'],
    contexts: ['manual-d'],
    answer: `**Equal Friction Method** sizes every duct run at the same friction rate. This is the standard residential approach recommended by ACCA Manual D.

How it works:
1. Calculate available static pressure (blower minus filter/coil losses)
2. Find the critical path (longest total equivalent length)
3. Set friction rate = available SP ÷ critical path TEL × 100
4. Size every duct to meet its CFM requirement at that friction rate

This ensures balanced pressure across all runs. Shorter runs may need balancing dampers to avoid over-delivery.`,
  },
  {
    keywords: ['fitting', 'equivalent length', 'elbow', 'tee', 'takeoff', 'boot', 'tel'],
    contexts: ['manual-d'],
    answer: `**Fittings** add resistance to duct runs. Each fitting has an **equivalent length (EL)** — the length of straight duct that would cause the same pressure drop.

Common residential fitting equivalent lengths:
| Fitting | Equivalent Length |
|---------|-----------------|
| 90° elbow | 10–15 ft |
| 45° elbow | 5–7 ft |
| Tee (branch) | 30–40 ft |
| Wye | 10–15 ft |
| Round takeoff | 10–20 ft |
| Register boot | 10–15 ft |
| Manual damper | 5 ft |

**TEL (Total Equivalent Length)** = actual duct length + sum of all fitting ELs. This determines your friction rate design.`,
  },
  {
    keywords: ['velocity', 'speed', 'fpm', 'noise', 'velocity limit'],
    contexts: ['manual-d'],
    answer: `**Duct Velocity** is how fast air moves through the duct, in feet per minute (FPM).

Residential velocity limits (supply ducts):
| Duct Type | Max FPM | Notes |
|-----------|---------|-------|
| Main trunk | 900 FPM | Keeps noise down |
| Branch runs | 600 FPM | Bedroom comfort |
| Return ducts | 700 FPM | Slightly more tolerant |

**Too high?** Increase duct size. Going from 6" to 7" round drops velocity by ~30%.

**Too low?** Not usually a problem, but very low velocity (< 200 FPM) can cause air stratification.

Formula: \`Velocity = CFM / Duct Area (sq ft)\``,
  },
  {
    keywords: ['static pressure', 'esp', 'blower', 'pressure budget'],
    contexts: ['manual-d'],
    answer: `**Static Pressure Budget** determines how much pressure your blower has to push air through the duct system.

The budget:
\`Available SP = Blower ESP − Filter Drop − Coil Drop\`

Typical residential values:
- **Blower ESP:** 0.4–0.8 inwg (from equipment specs)
- **Filter drop:** 0.08–0.15 inwg (standard 1" filter)
- **Coil drop:** 0.15–0.25 inwg (standard DX coil)
- **Available:** 0.15–0.40 inwg for the duct system

If your duct system exceeds the available SP, the blower can't deliver rated airflow — rooms will be underserved.`,
  },
  {
    keywords: ['import manual j', 'import from', 'cfm from', 'room cfm', 'airflow distribution'],
    contexts: ['manual-d'],
    answer: `**Importing from Manual J** auto-populates your duct runs with room names and CFM values.

How CFM is distributed:
\`Room CFM = Equipment CFM × (Room Cooling BTU / Total Cooling BTU)\`

Equipment CFM = Recommended Tons × 400 CFM/ton

Example: 5-ton system = 2,000 CFM total
- Kitchen (8,973 BTU / 55,530 total) = 323 CFM
- Bedroom (1,350 BTU / 55,530 total) = 49 CFM

Click **Import from Manual J** in the Duct Runs section. It reads from your last Manual J calculation for the active project.`,
  },
  {
    keywords: ['balance', 'balancing', 'damper', 'system balance'],
    contexts: ['manual-d'],
    answer: `**System Balance** means every room gets its design airflow. The calculator checks this automatically.

**Balanced:** All rooms within ±10% of design CFM. Good to go.

**Needs Balancing:** Some runs have excess capacity. Install **balancing dampers** on shorter runs to throttle airflow and redirect it to longer (critical) runs.

**CFM Mismatch Warning:** If total room CFM differs from equipment CFM by >5%, check that all rooms are accounted for. Common causes:
- Hallways/stairs not included (they need return air paths)
- Equipment CFM not updated after Manual J import`,
  },

  // ── Internal Loads ──────────────────────────────────────────────────────────
  {
    keywords: ['internal load', 'internal gain', 'appliance', 'room type', 'activity level', 'lighting', 'heat source', 'occupant', 'people load'],
    contexts: ['manualj', 'manual-d', 'cad'],
    answer: `**Internal Loads** account for every heat source inside a room beyond the building envelope.

**Room Type Presets** — select a room type (Kitchen, Bedroom, Fitness, etc.) to auto-fill:
- **Occupant count & activity level** (sleeping 200 BTU/hr → heavy exercise 700 BTU/hr per person)
- **Appliances** (gas range 2,200S/1,200L, refrigerator 400S, etc.)
- **Lighting** (LED 0.5 BTU/sqft, fluorescent 1.0, incandescent 3.0)

**Appliance Library** — 19 equipment types with calibrated sensible + latent BTU values from ACCA Manual J Table 6 and ASHRAE Fundamentals.

**Miscellaneous Loads** — free-form BTU input for anything: server racks, aquariums, grow lights, hot tubs. If it produces heat, enter it here.

All values are presets that you can override — the room type just gives you a starting point.`,
  },

  // ── Project Management ──────────────────────────────────────────────────────
  {
    keywords: ['project', 'new project', 'switch project', 'project isolation', 'create project', 'draft mode'],
    contexts: ['manualj', 'manual-d', 'cad'],
    answer: `**Project Isolation** keeps each project's data completely separate.

**Creating a project:** When you enter Manual J or Manual D without an active project, a dialog asks you to select an existing project, create a new one, or continue as draft.

**Project Context Bar** — the bar at the top of calculators shows your active project name, type, and a **Switch** dropdown to quickly change projects.

**Data scoping:** Each project has its own:
- Manual J rooms, conditions, and results
- Manual D duct runs and system config
- CAD floor plans and geometry

**Draft mode:** Work without a project — data saves under a "draft" scope. Useful for quick calculations that don't belong to a specific building.`,
  },

  // ── Feedback ────────────────────────────────────────────────────────────────
  {
    keywords: ['feedback', 'bug report', 'submit bug', 'report issue', 'feature request', 'idea'],
    contexts: ['manualj', 'manual-d', 'cad'],
    answer: `**Submit Feedback** directly from Mason!

Click the **+** button in my header to open the feedback form.

**Three types:**
- **Bug** — something's broken or unexpected
- **Idea** — a feature suggestion or improvement
- **Question** — need help understanding something

**Attach files** three ways:
- **Click** "Attach Screenshot" or "Add File"
- **Drag & drop** files onto the form
- **Ctrl+V** to paste screenshots from your clipboard

Supports images, videos, PDFs, docs, and text files (up to 5 files, 10MB each).

Submissions go to the C4 Technologies support team and are tracked in our system.`,
  },

  // ── Session Persistence ─────────────────────────────────────────────────────
  {
    keywords: ['session', 'save state', 'remember', 'persist', 'left off', 'restore', 'workspace state'],
    contexts: ['manualj', 'manual-d', 'cad'],
    answer: `**Your workspace saves automatically.** When you return, everything is right where you left it.

What persists between sessions:
- **CAD workspace:** panel visibility, toolbar position, zoom level, ghost floors toggle, all geometry
- **Manual J:** all room inputs, design conditions, calculation results (per project)
- **Manual D:** system config, duct runs, fittings (per project)
- **Settings:** theme, units, PDF preferences, firm stamps

**Per-project isolation:** Each project saves its own calculator data. Switch projects and your workspace updates automatically.`,
  },
];

function findAnswer(query: string, context: MasonContext): string {
  const q = query.toLowerCase();
  let bestMatch: KBEntry | null = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(kw)) score += kw.length;
    }
    // Boost score if the entry matches the current context
    if (score > 0 && entry.contexts.includes(context)) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && bestScore > 0) return bestMatch.answer;

  const contextHelp = context === 'manualj'
    ? `I can help you fill out the Manual J calculator. Try asking about:\n\n- **How to measure** rooms and windows\n- **Design temperatures** for your city\n- **R-values** — what's in your walls\n- **Window types** — U-factor and SHGC\n- **Construction quality** and air leakage\n- **Duct location** impact\n- **Understanding results** — BTU and tonnage\n- **Daily range** and humidity grains`
    : `I'm your complete guide to HVAC DesignPro. Try asking about:\n\n- **Getting started** — first steps, canvas navigation\n- **Drawing walls**, placing windows & doors\n- **HVAC placement** — registers, grilles, equipment\n- **3D View** — orbit, pan, zoom, inspect\n- **Keyboard shortcuts** — every hotkey\n- **Search** (Ctrl+K) — find any asset instantly\n- **Labels & text** — fonts, colors, styling\n- **Import images** — underlays for tracing\n- **Export PDF** — multi-page engineering docs\n- **Room detection**, multi-floor, layers\n- **Appearance** — customize colors and theme\n- **R-values**, insulation, CFM, equipment sizing`;

  return contextHelp;
}

function processCommands(query: string, context: MasonContext): string | null {
  const q = query.trim().toLowerCase();

  // ── /status — enhanced with all workspace data ─────────────────────
  if (q === '/status') {
    const cadStore = useCadStore.getState();
    const projStore = useProjectStore.getState();
    const projectId = projStore.activeProjectId;
    const numRooms = cadStore.floors.flatMap(f => f.rooms).length;
    const numWalls = cadStore.floors.flatMap(f => f.walls).length;

    let mjStatus = '';
    try {
      const resultsRaw = localStorage.getItem(`hvac_manualj_results_${projectId || 'draft'}`);
      if (resultsRaw) {
        const r = JSON.parse(resultsRaw);
        mjStatus = `\n- **Manual J**: ${r.rooms?.length || 0} rooms, ${r.totalHeatingBtu?.toLocaleString() || 0} BTU/hr heating, ${r.totalCoolingBtu?.toLocaleString() || 0} cooling, ${r.recommendedTons || '?'} ton recommended`;
      }
    } catch { /* */ }

    let mdStatus = '';
    try {
      const mdRaw = localStorage.getItem(`hvac_manuald_inputs_${projectId || 'draft'}`);
      if (mdRaw) {
        const d = JSON.parse(mdRaw);
        mdStatus = `\n- **Manual D**: ${d.rooms?.length || 0} duct runs, ${d.equipmentCfm || '?'} CFM equipment`;
      }
    } catch { /* */ }

    return `**Live Workspace Status**

- **Project**: ${projStore.activeProjectName || 'No project (draft mode)'}
- **Project Type**: ${projStore.activeProjectType || 'N/A'}
- **Current Floor**: ${cadStore.floors.find(f => f.id === cadStore.activeFloorId)?.name || 'N/A'}
- **Total Floors**: ${cadStore.floors.length}
- **Detected Rooms in CAD**: ${numRooms}
- **Walls Drawn**: ${numWalls}${mjStatus}${mdStatus}
- **Current Workspace**: ${context === 'manualj' ? 'Manual J Calculator' : context === 'manual-d' ? 'Manual D Calculator' : 'CAD Workspace'}`;
  }

  // ── /navigate — workspace navigation ───────────────────────────────
  if (q.startsWith('/navigate ') || q.startsWith('/go ') || q.startsWith('/open ')) {
    const target = q.replace(/^\/(navigate|go|open)\s+/, '').trim();
    const routes: Record<string, [string, string]> = {
      'manual-j':   ['/calculator', 'Manual J Calculator'],
      'manualj':    ['/calculator', 'Manual J Calculator'],
      'calculator': ['/calculator', 'Manual J Calculator'],
      'manual-d':   ['/manual-d', 'Manual D Calculator'],
      'manuald':    ['/manual-d', 'Manual D Calculator'],
      'duct':       ['/manual-d', 'Manual D Calculator'],
      'cad':        ['/cad', 'CAD Workspace'],
      'workspace':  ['/cad', 'CAD Workspace'],
      'drawing':    ['/cad', 'CAD Workspace'],
      'settings':   ['/settings', 'Settings'],
      'preferences':['/settings', 'Settings'],
      'dashboard':  ['/dashboard', 'Dashboard'],
      'projects':   ['/dashboard', 'Dashboard'],
      'guide':      ['/guide', 'User Guide'],
      'help':       ['/guide', 'User Guide'],
      'team':       ['/team', 'Team Management'],
    };
    const match = routes[target];
    if (match) {
      setTimeout(() => { window.location.href = match[0]; }, 500);
      return `Navigating to **${match[1]}**...`;
    }
    return `I don't recognize "${target}". Try: manual-j, manual-d, cad, settings, dashboard, guide, or team.`;
  }

  // ── /calculate — trigger Manual J calculation ──────────────────────
  if (q === '/calculate' || q === '/calc' || q === '/run') {
    if (context === 'manualj') {
      setTimeout(() => {
        const btn = document.querySelector('button') && Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Calculate Loads'));
        if (btn) (btn as HTMLButtonElement).click();
      }, 300);
      return `Running **Manual J calculation**... Check results below.`;
    }
    if (context === 'manual-d') {
      setTimeout(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Calculate Duct'));
        if (btn) (btn as HTMLButtonElement).click();
      }, 300);
      return `Running **Manual D duct sizing**... Check results below.`;
    }
    return `The /calculate command works on the Manual J and Manual D pages. Navigate there first with \`/navigate manual-j\`.`;
  }

  // ── /export — trigger exports ──────────────────────────────────────
  if (q === '/export pdf' || q === '/pdf') {
    setTimeout(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Export PDF'));
      if (btn) (btn as HTMLButtonElement).click();
    }, 300);
    return `Exporting **PDF report**...`;
  }
  if (q === '/export cad' || q === '/to cad') {
    setTimeout(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Export to CAD'));
      if (btn) (btn as HTMLButtonElement).click();
    }, 300);
    return `Opening **Export to CAD** dialog...`;
  }

  // ── /import — trigger Manual J import in Manual D ──────────────────
  if (q === '/import' || q === '/import manual-j' || q === '/import mj') {
    if (context === 'manual-d') {
      setTimeout(() => {
        const btn = Array.from(document.querySelectorAll('button, span')).find(b => b.textContent?.includes('Import from Manual J'));
        if (btn) (btn as HTMLElement).click();
      }, 300);
      return `Importing rooms from **Manual J** results...`;
    }
    return `The /import command works on the Manual D page. Navigate there with \`/navigate manual-d\`.`;
  }

  // ── Smart queries about current results ────────────────────────────
  const projId = useProjectStore.getState().activeProjectId;

  if (q.includes('biggest') || q.includes('largest') || q.includes('highest') || q.includes('most')) {
    try {
      const raw = localStorage.getItem(`hvac_manualj_results_${projId || 'draft'}`);
      if (raw) {
        const r = JSON.parse(raw);
        if (r.rooms?.length) {
          if (q.includes('heat') || q.includes('heating')) {
            const sorted = [...r.rooms].sort((a: any, b: any) => b.heatingBtu - a.heatingBtu);
            return `The **highest heating load** is **${sorted[0].roomName}** at **${sorted[0].heatingBtu.toLocaleString()} BTU/hr**.\n\nTop 3:\n1. ${sorted[0].roomName} — ${sorted[0].heatingBtu.toLocaleString()}\n2. ${sorted[1]?.roomName || 'N/A'} — ${sorted[1]?.heatingBtu?.toLocaleString() || 'N/A'}\n3. ${sorted[2]?.roomName || 'N/A'} — ${sorted[2]?.heatingBtu?.toLocaleString() || 'N/A'}`;
          }
          const sorted = [...r.rooms].sort((a: any, b: any) => b.coolingBtuTotal - a.coolingBtuTotal);
          return `The **highest cooling load** is **${sorted[0].roomName}** at **${sorted[0].coolingBtuTotal.toLocaleString()} BTU/hr**.\n\nTop 3:\n1. ${sorted[0].roomName} — ${sorted[0].coolingBtuTotal.toLocaleString()}\n2. ${sorted[1]?.roomName || 'N/A'} — ${sorted[1]?.coolingBtuTotal?.toLocaleString() || 'N/A'}\n3. ${sorted[2]?.roomName || 'N/A'} — ${sorted[2]?.coolingBtuTotal?.toLocaleString() || 'N/A'}`;
        }
      }
    } catch { /* */ }
    return `No calculation results found. Run a Manual J calculation first, then ask me again.`;
  }

  if (q.includes('tonnage') || q.includes('recommended') || q.includes('equipment size')) {
    try {
      const raw = localStorage.getItem(`hvac_manualj_results_${projId || 'draft'}`);
      if (raw) {
        const r = JSON.parse(raw);
        return `**Recommended equipment:** ${r.recommendedTons} Ton\n\n- Heating: ${r.totalHeatingBtu?.toLocaleString()} BTU/hr (${(r.totalHeatingBtu / 12000).toFixed(1)} tons)\n- Cooling: ${r.totalCoolingBtu?.toLocaleString()} BTU/hr (${(r.totalCoolingBtu / 12000).toFixed(1)} tons)\n- SHR: ${r.sensibleHeatRatio}\n- Ventilation: ${r.ventilationCFM} CFM`;
      }
    } catch { /* */ }
    return `No calculation results found. Run a Manual J calculation first.`;
  }

  if (q.includes('how many rooms') || q.includes('room count')) {
    try {
      const raw = localStorage.getItem(`hvac_manualj_inputs_${projId || 'draft'}`);
      if (raw) {
        const d = JSON.parse(raw);
        const rooms = d.rooms || [];
        const byFloor = new Map<string, number>();
        rooms.forEach((r: any) => {
          const f = r.floorName || 'Unassigned';
          byFloor.set(f, (byFloor.get(f) || 0) + 1);
        });
        let breakdown = '';
        byFloor.forEach((count, floor) => { breakdown += `\n- ${floor}: ${count} rooms`; });
        return `**${rooms.length} rooms** in the active project.${breakdown}`;
      }
    } catch { /* */ }
    return `No room data found for the active project.`;
  }

  // ── /help — list available commands ────────────────────────────────
  if (q === '/help' || q === '/commands') {
    return `**Mason Commands:**

| Command | Action |
|---------|--------|
| \`/status\` | Show project & workspace status |
| \`/calculate\` | Run Manual J or D calculation |
| \`/export pdf\` | Export PDF report |
| \`/export cad\` | Export to CAD workspace |
| \`/import\` | Import Manual J data into Manual D |
| \`/navigate <page>\` | Go to a page (manual-j, manual-d, cad, settings, dashboard) |
| \`/help\` | Show this list |

**Smart Questions** (just ask naturally):
- "What's the biggest cooling load?"
- "What's the recommended tonnage?"
- "How many rooms are there?"`;
  }

  return null;
}

// ── Quick calculators ───────────────────────────────────────────────────────
interface QuickCalc {
  id: string;
  label: string;
  icon: React.ReactNode;
  fields: { name: string; label: string; unit: string; default: number }[];
  compute: (vals: Record<string, number>) => string;
}

const quickCalcs: QuickCalc[] = [
  {
    id: 'btu',
    label: 'BTU Estimator',
    icon: <Thermometer className="w-3.5 h-3.5" />,
    fields: [
      { name: 'area', label: 'Room Area', unit: 'sq ft', default: 200 },
      { name: 'dt', label: 'Temp Diff', unit: '°F', default: 20 },
      { name: 'rval', label: 'R-Value', unit: '', default: 19 },
    ],
    compute: (v) => {
      const uFactor = 1 / v.rval;
      const btu = v.area * uFactor * v.dt;
      return `Wall heat transfer: **${btu.toFixed(0)} BTU/h**\n\nArea × (1/R) × ΔT = ${v.area} × ${uFactor.toFixed(4)} × ${v.dt}`;
    },
  },
  {
    id: 'cfm',
    label: 'CFM',
    icon: <Wind className="w-3.5 h-3.5" />,
    fields: [
      { name: 'tons', label: 'Cooling Tons', unit: 'tons', default: 3 },
    ],
    compute: (v) => {
      const cfm = v.tons * 400;
      return `Airflow needed: **${cfm} CFM**\n\n~400 CFM per ton. A ${v.tons}-ton system needs ${cfm} CFM total supply.`;
    },
  },
  {
    id: 'duct',
    label: 'Duct Size',
    icon: <Calculator className="w-3.5 h-3.5" />,
    fields: [
      { name: 'cfm', label: 'CFM', unit: 'CFM', default: 200 },
      { name: 'velocity', label: 'Max FPM', unit: 'FPM', default: 700 },
    ],
    compute: (v) => {
      const areaSqIn = (v.cfm / v.velocity) * 144;
      const diameter = Math.sqrt((4 * areaSqIn) / Math.PI);
      return `Round duct: **${diameter.toFixed(1)}" diameter**\n\nDuct area: ${areaSqIn.toFixed(1)} sq in at ${v.velocity} FPM for ${v.cfm} CFM.`;
    },
  },
];

// ── Chat message ────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'mason';
  content: string;
}

// ── Quick topics by context ─────────────────────────────────────────────────
const QUICK_TOPICS: Record<MasonContext, string[]> = {
  manualj: [
    'How to measure rooms',
    'Window measurements',
    'Design temperatures',
    'What R-value do I have?',
    'Construction quality',
    'Duct location impact',
    'Understanding results',
    'Daily range explained',
    'Humidity & grains',
  ],
  cad: [
    'Getting started',
    'How to draw walls',
    'Placing windows & doors',
    'HVAC unit placement',
    '3D View controls',
    'Keyboard shortcuts',
    'Search assets (Ctrl+K)',
    'Labels & text',
    'Import images',
    'Export PDF report',
    'Room detection',
    'Multi-floor design',
    'Layer controls',
    'Appearance & colors',
    'Auto-save & undo',
  ],
  'manual-d': [
    'Duct sizing basics',
    'Friction rate method',
    'Equal friction design',
    'Fitting equivalent lengths',
    'Supply vs return sizing',
    'Trunk & branch layout',
    'Velocity limits',
    'Static pressure budget',
  ],
};

// ── Props ───────────────────────────────────────────────────────────────────
interface MasonProps {
  context: MasonContext;
  /** Position offset for different pages */
  position?: 'bottom-right' | 'bottom-left';
}

export default function Mason({ context, position = 'bottom-right' }: MasonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeCalc, setActiveCalc] = useState<string | null>(null);
  const [calcValues, setCalcValues] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Feedback form state
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'suggestion' | 'question'>('bug');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const feedbackFileRef = useRef<HTMLInputElement>(null);
  const feedbackFormRef = useRef<HTMLDivElement>(null);
  const { user, organisation } = useAuthStore();

  // Add files (from any source: click, drag, paste)
  const addFeedbackFiles = useCallback((newFiles: FileList | File[]) => {
    const maxSize = 10 * 1024 * 1024; // 10MB per file
    const maxFiles = 5;
    const arr = Array.from(newFiles);
    const valid = arr.filter(f => {
      if (f.size > maxSize) { setFeedbackError(`${f.name} exceeds 10MB limit`); return false; }
      return true;
    });
    setFeedbackFiles(prev => {
      const combined = [...prev, ...valid];
      if (combined.length > maxFiles) {
        setFeedbackError(`Max ${maxFiles} files allowed`);
        return combined.slice(0, maxFiles);
      }
      return combined;
    });
  }, []);

  // Paste handler for clipboard images
  useEffect(() => {
    if (!showFeedback) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFeedbackFiles(files);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [showFeedback, addFeedbackFiles]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => {
          setInput('/cad ');
          inputRef.current?.focus();
        }, 50);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (text?: string) => {
    const query = text || input.trim();
    if (!query) return;

    const userMsg: ChatMessage = { role: 'user', content: query };
    
    // Check for special commands first
    const commandResponse = processCommands(query, context);
    const answer = commandResponse || findAnswer(query, context);
    
    const masonMsg: ChatMessage = { role: 'mason', content: answer };
    setMessages(prev => [...prev, userMsg, masonMsg]);
    setInput('');
  };

  const runCalc = (calc: QuickCalc) => {
    const result = calc.compute(calcValues);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: `Calculate: ${calc.label}` },
      { role: 'mason', content: result },
    ]);
    setActiveCalc(null);
  };

  const posClass = position === 'bottom-left' ? 'left-6' : 'right-6';
  const tooltipSide = position === 'bottom-left' ? 'left-full ml-3' : 'right-full mr-3';
  const tooltipPointerSide = position === 'bottom-left'
    ? 'absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-l border-b border-slate-700 rotate-45'
    : 'absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-r border-t border-slate-700 rotate-45';

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 ${posClass} z-[60] p-3.5 rounded-2xl glass-panel border border-amber-500/20 backdrop-blur-xl bg-slate-900/80 text-amber-400 hover:text-amber-300 hover:border-amber-500/40 hover:bg-slate-800/80 transition-all shadow-[0_0_30px_rgba(0,0,0,0.5),0_0_15px_rgba(245,158,11,0.1)] group`}
        aria-label="Ask Mason — HVAC AI Assistant"
      >
        <div className="relative">
          <Zap className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        </div>
        <div className={`absolute ${tooltipSide} top-1/2 -translate-y-1/2 px-3 py-2 bg-slate-800/95 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-md shadow-xl`}>
          <span className="font-bold text-amber-400">Mason</span> — AI HVAC Assistant
          <div className={tooltipPointerSide} />
        </div>
      </button>
    );
  }

  return (
    <div className={`fixed bottom-6 ${posClass} z-[60] w-[400px] max-h-[75vh] glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6),0_0_20px_rgba(245,158,11,0.05)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/85 overflow-hidden animate-in zoom-in-95 fade-in duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-gradient-to-r from-slate-900/80 to-amber-950/20 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">Mason</h3>
            <p className="text-[10px] text-slate-500 font-medium">
              {context === 'manualj' ? 'Manual J Assistant' : 'CAD & HVAC Assistant'}
            </p>
          </div>
          <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ml-1">Online</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowFeedback(!showFeedback); setFeedbackSubmitted(false); }}
            className={`p-1.5 rounded-lg transition-colors ${showFeedback ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'}`}
            title="Submit Feedback"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
          <a
            href="tel:+13153933791"
            className="p-1.5 rounded-lg text-emerald-500 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors group/phone relative"
            aria-label="Call Howland Pump & Supply"
          >
            <Phone className="w-4 h-4" />
            <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-slate-800/95 border border-slate-700 text-[10px] text-slate-200 rounded-lg opacity-0 group-hover/phone:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              <span className="font-bold text-emerald-400">(315) 393-3791</span>
            </div>
          </a>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-[200px]">
        {messages.length === 0 && (
          <div className="space-y-4">
            {/* Mason intro */}
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-slate-300 leading-relaxed">
                {context === 'manualj' ? (
                  <>Hey, I'm <strong className="text-amber-400">Mason</strong>. I'll help you fill out this Manual J calculator — room measurements, design temps, insulation values, all of it. Ask me anything or tap a topic below.</>
                ) : (
                  <>Hey, I'm <strong className="text-amber-400">Mason</strong> — your HVAC engineering assistant. I know every tool, shortcut, and feature in this platform inside and out. Ask me anything — drawing walls, 3D view, keyboard shortcuts, load calcs, duct sizing, you name it. Tap a topic below or just ask.</>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pl-9">
              {QUICK_TOPICS[context].map(topic => (
                <button
                  key={topic}
                  onClick={() => handleSend(topic)}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-amber-400 hover:border-amber-500/20 transition-all font-medium"
                >
                  {topic}
                </button>
              ))}
            </div>

            {/* Quick calculators */}
            <div className="pt-3 border-t border-slate-800/50 pl-9">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold mb-2">Quick Calculators</p>
              <div className="flex gap-2 flex-wrap">
                {quickCalcs.map(calc => (
                  <button
                    key={calc.id}
                    onClick={() => {
                      setActiveCalc(activeCalc === calc.id ? null : calc.id);
                      const defaults: Record<string, number> = {};
                      calc.fields.forEach(f => { defaults[f.name] = f.default; });
                      setCalcValues(defaults);
                    }}
                    className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border font-semibold transition-all ${
                      activeCalc === calc.id
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-amber-400 hover:border-amber-500/20'
                    }`}
                  >
                    {calc.icon}
                    {calc.label}
                  </button>
                ))}
              </div>

              {activeCalc && (() => {
                const calc = quickCalcs.find(c => c.id === activeCalc);
                if (!calc) return null;
                return (
                  <div className="mt-2 p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2 animate-in fade-in duration-200">
                    {calc.fields.map(field => (
                      <div key={field.name} className="flex items-center gap-2">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider w-24 flex-shrink-0">{field.label}</label>
                        <input
                          type="number"
                          value={calcValues[field.name] ?? field.default}
                          onChange={e => setCalcValues(prev => ({ ...prev, [field.name]: parseFloat(e.target.value) || 0 }))}
                          className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-500/50 transition-colors"
                        />
                        {field.unit && <span className="text-[10px] text-slate-600 w-8 flex-shrink-0">{field.unit}</span>}
                      </div>
                    ))}
                    <button
                      onClick={() => runCalc(calc)}
                      className="w-full py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold hover:bg-amber-500/20 transition-colors"
                    >
                      Calculate
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'mason' && (
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
            )}
            <div className={`max-w-[85%] px-3 py-2.5 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 rounded-xl rounded-tr-sm'
                : 'bg-slate-800/50 border border-slate-700/50 text-slate-300 rounded-xl rounded-tl-sm'
            }`}>
              {msg.content.split('\n').map((line, j) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return <p key={j} className="font-bold text-slate-100 mb-1 mt-1 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
                }
                if (line.startsWith('|')) {
                  return <p key={j} className="font-mono text-[10px] text-slate-400">{line}</p>;
                }
                if (line.startsWith('- ')) {
                  const parts = line.slice(2).split(/\*\*(.*?)\*\*/g);
                  return <p key={j} className="pl-2">{'• '}{parts.map((part, k) => k % 2 === 1 ? <strong key={k} className="text-slate-100">{part}</strong> : part)}</p>;
                }
                if (line === '') return <br key={j} />;
                const parts = line.split(/\*\*(.*?)\*\*/g);
                return <p key={j}>{parts.map((part, k) => k % 2 === 1 ? <strong key={k} className="text-slate-100">{part}</strong> : part)}</p>;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Quick topics when messages exist */}
      {messages.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-800/50 flex-shrink-0">
          <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
            {QUICK_TOPICS[context].slice(0, 5).map(topic => (
              <button
                key={topic}
                onClick={() => handleSend(topic)}
                className="text-[9px] px-2 py-1 rounded-md bg-slate-800/40 border border-slate-700/40 text-slate-500 hover:text-amber-400 transition-all whitespace-nowrap flex-shrink-0"
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feedback Form (replaces input when active) */}
      {showFeedback ? (
        <div
          ref={feedbackFormRef}
          className={`p-4 border-t border-slate-800 bg-slate-900/50 flex-shrink-0 space-y-3 ${isDragging ? 'ring-2 ring-amber-500/50 bg-amber-500/5' : ''}`}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
          onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setIsDragging(false);
            if (e.dataTransfer.files.length > 0) addFeedbackFiles(e.dataTransfer.files);
          }}
        >
          {feedbackSubmitted ? (
            <div className="text-center py-4 space-y-2">
              <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-sm font-bold text-emerald-400">Feedback Submitted</p>
              <p className="text-[10px] text-slate-500">Sent to support@c4tech.co — our team will review this.</p>
              <button onClick={() => { setShowFeedback(false); setFeedbackSubmitted(false); setFeedbackError(null); }} className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 mx-auto mt-2">
                <ArrowLeft className="w-3 h-3" /> Back to Chat
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-300">Submit Feedback</p>
                <button onClick={() => { setShowFeedback(false); setFeedbackError(null); }} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>
              </div>

              {/* Type selector */}
              <div className="flex gap-2">
                {(['bug', 'suggestion', 'question'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setFeedbackType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${feedbackType === t ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-slate-800/50 text-slate-500 border border-slate-700/50 hover:text-slate-300'}`}
                  >
                    {t === 'bug' ? 'Bug' : t === 'suggestion' ? 'Idea' : 'Question'}
                  </button>
                ))}
              </div>

              {/* Description (also accepts paste) */}
              <textarea
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                placeholder="Describe the issue or suggestion... (Ctrl+V to paste images)"
                rows={3}
                className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-slate-600 resize-none"
              />

              {/* File attachments */}
              <input ref={feedbackFileRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.log" multiple className="hidden" onChange={(e) => {
                if (e.target.files) addFeedbackFiles(e.target.files);
                e.target.value = '';
              }} />

              {/* Drag-drop hint when dragging */}
              {isDragging && (
                <div className="text-center py-3 border-2 border-dashed border-amber-500/40 rounded-xl">
                  <p className="text-[10px] text-amber-400 font-bold">Drop files here</p>
                </div>
              )}

              {/* Attached files list */}
              {feedbackFiles.length > 0 && (
                <div className="space-y-1.5 max-h-24 overflow-y-auto">
                  {feedbackFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-2.5 py-1.5">
                      {file.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(file)} alt="" className="w-7 h-7 rounded object-cover border border-slate-700 flex-shrink-0" />
                      ) : (
                        <Paperclip className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      )}
                      <span className="text-[10px] text-slate-400 flex-1 truncate">{file.name}</span>
                      <span className="text-[9px] text-slate-600 flex-shrink-0">{(file.size / 1024).toFixed(0)}KB</span>
                      <button onClick={() => setFeedbackFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 flex-shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add file buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => feedbackFileRef.current?.click()}
                  className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" /> Attach Screenshot
                </button>
                <button
                  onClick={() => feedbackFileRef.current?.click()}
                  className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Paperclip className="w-3.5 h-3.5" /> Add File
                </button>
                <span className="text-[9px] text-slate-700 ml-auto">or drag & drop / Ctrl+V</span>
              </div>

              {/* Error message */}
              {feedbackError && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {feedbackError}
                </div>
              )}

              {/* Submit */}
              <button
                disabled={!feedbackText.trim() || feedbackSending}
                onClick={async () => {
                  setFeedbackSending(true);
                  setFeedbackError(null);
                  try {
                    // Try API first
                    await api.submitFeedback({
                      type: feedbackType,
                      text: feedbackText,
                      context,
                      userAgent: navigator.userAgent,
                      files: feedbackFiles,
                    });
                    setFeedbackText('');
                    setFeedbackFiles([]);
                    setFeedbackSubmitted(true);
                  } catch {
                    // Fallback to localStorage if API unreachable
                    try {
                      const fallbackData = {
                        type: feedbackType,
                        text: feedbackText,
                        fileCount: feedbackFiles.length,
                        context,
                        timestamp: new Date().toISOString(),
                        userAgent: navigator.userAgent,
                        userName: user ? `${user.firstName} ${user.lastName}` : 'unknown',
                        userEmail: user?.email || 'unknown',
                        orgName: organisation?.name || 'unknown',
                      };
                      const existing = JSON.parse(localStorage.getItem('hvac_feedback') || '[]');
                      existing.push(fallbackData);
                      localStorage.setItem('hvac_feedback', JSON.stringify(existing));
                      setFeedbackText('');
                      setFeedbackFiles([]);
                      setFeedbackSubmitted(true);
                    } catch {
                      setFeedbackError('Failed to submit. Please try again.');
                    }
                  } finally {
                    setFeedbackSending(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all disabled:opacity-30"
              >
                {feedbackSending ? (
                  <span className="animate-pulse">Sending...</span>
                ) : (
                  <><Send className="w-3.5 h-3.5 inline mr-1.5" /> Submit Feedback</>
                )}
              </button>
            </>
          )}
        </div>
      ) : (
        /* Input */
        <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex-shrink-0">
          <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={context === 'manualj' ? "Ask Mason or type /status..." : "Ask Mason about HVAC, or type /status..."}
                className="w-full bg-slate-950/80 border border-slate-700 text-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-slate-600"
              />
              {input === '/' && (
                <div className="absolute bottom-full mb-2 left-0 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden py-1 z-10 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-amber-500/10 hover:text-amber-400 flex items-center gap-2"
                    onClick={() => { setInput('/status'); inputRef.current?.focus(); }}
                  >
                    <Command className="w-3.5 h-3.5" />
                    <span className="font-mono">/status</span>
                    <span className="text-slate-500 text-[10px] ml-auto">CAD State</span>
                  </button>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
