import { useState, useRef, useEffect } from 'react';
import { X, Send, Zap, Thermometer, Wind, Calculator } from 'lucide-react';

// ── Steve — your AI HVAC engineering assistant ─────────────────────────────────
// Named after the countless engineers who've built the world's buildings.
// Unified across CAD workspace and Manual J Calculator.

// ── Context mode determines which knowledge is prioritized ─────────────────────
export type SteveContext = 'cad' | 'manualj';

// ── Knowledge base ─────────────────────────────────────────────────────────────
interface KBEntry {
  keywords: string[];
  contexts: SteveContext[];
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
  // ── CAD specific ───────────────────────────────────────────────────────────
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

Select the placed opening to edit dimensions and thermal properties in the right panel.`,
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
];

function findAnswer(query: string, context: SteveContext): string {
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
    : `I can help with HVAC design and CAD. Try asking about:\n\n- **Drawing walls** and floor plans\n- **Placing windows & doors** on walls\n- **HVAC unit placement** and types\n- **Room detection** from wall layouts\n- **Layers** and multi-floor design\n- **R-values** and insulation\n- **CFM** and duct sizing\n- **Equipment sizing** and tonnage`;

  return contextHelp;
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
  role: 'user' | 'steve';
  content: string;
}

// ── Quick topics by context ─────────────────────────────────────────────────
const QUICK_TOPICS: Record<SteveContext, string[]> = {
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
    'How to draw walls',
    'Placing windows & doors',
    'HVAC unit placement',
    'Room detection',
    'Multi-floor design',
    'Layer controls',
    'R-value guide',
    'CFM & duct sizing',
    'Equipment tonnage',
  ],
};

// ── Props ───────────────────────────────────────────────────────────────────
interface SteveProps {
  context: SteveContext;
  /** Position offset for different pages */
  position?: 'bottom-right' | 'bottom-left';
}

export default function Steve({ context, position = 'bottom-right' }: SteveProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeCalc, setActiveCalc] = useState<string | null>(null);
  const [calcValues, setCalcValues] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (text?: string) => {
    const query = text || input.trim();
    if (!query) return;

    const userMsg: ChatMessage = { role: 'user', content: query };
    const answer = findAnswer(query, context);
    const steveMsg: ChatMessage = { role: 'steve', content: answer };
    setMessages(prev => [...prev, userMsg, steveMsg]);
    setInput('');
  };

  const runCalc = (calc: QuickCalc) => {
    const result = calc.compute(calcValues);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: `Calculate: ${calc.label}` },
      { role: 'steve', content: result },
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
        aria-label="Ask Steve — HVAC AI Assistant"
      >
        <div className="relative">
          <Zap className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        </div>
        <div className={`absolute ${tooltipSide} top-1/2 -translate-y-1/2 px-3 py-2 bg-slate-800/95 border border-slate-700 text-slate-200 text-xs font-medium rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-md shadow-xl`}>
          <span className="font-bold text-amber-400">Steve</span> — AI HVAC Assistant
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
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">Steve</h3>
            <p className="text-[10px] text-slate-500 font-medium">
              {context === 'manualj' ? 'Manual J Assistant' : 'CAD & HVAC Assistant'}
            </p>
          </div>
          <span className="text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ml-1">Online</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-[200px]">
        {messages.length === 0 && (
          <div className="space-y-4">
            {/* Steve intro */}
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl rounded-tl-sm px-3 py-2.5 text-xs text-slate-300 leading-relaxed">
                {context === 'manualj' ? (
                  <>Hey, I'm <strong className="text-amber-400">Steve</strong>. I'll help you fill out this Manual J calculator — room measurements, design temps, insulation values, all of it. Ask me anything or tap a topic below.</>
                ) : (
                  <>Hey, I'm <strong className="text-amber-400">Steve</strong>. I can help with your CAD drawings, HVAC layout, load calculations, and equipment sizing. What are you working on?</>
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
            {msg.role === 'steve' && (
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

      {/* Input */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex-shrink-0">
        <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={context === 'manualj' ? "Ask Steve about measurements, R-values, temps..." : "Ask Steve about HVAC, walls, duct sizing..."}
            className="flex-1 bg-slate-950/80 border border-slate-700 text-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
