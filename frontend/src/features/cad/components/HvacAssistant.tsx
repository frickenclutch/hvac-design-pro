import { useState, useRef, useEffect } from 'react';
import { X, Send, Zap, Thermometer, Wind, Calculator } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';

// ── Built-in HVAC knowledge base ────────────────────────────────────────────
interface KBEntry {
  keywords: string[];
  answer: string;
}

const KNOWLEDGE_BASE: KBEntry[] = [
  {
    keywords: ['manual j', 'load calculation', 'heat load', 'cooling load'],
    answer: `**Manual J Load Calculation**\n\nManual J (ACCA) calculates heating & cooling loads based on:\n- **Building envelope** — wall R-values, window U-factors, SHGC\n- **Climate data** — outdoor design temps for your location\n- **Infiltration** — air leakage rate (ACH)\n- **Internal gains** — occupants, lighting, appliances\n\n**Quick formula:**\nCooling Load (BTU/h) = Area × U-value × Temperature Difference × Correction Factors\n\nUse the Manual J Calculator in the main nav for a full room-by-room analysis.`,
  },
  {
    keywords: ['r-value', 'r value', 'insulation', 'thermal resistance'],
    answer: `**R-Value Guide**\n\n| Assembly | Typical R-Value |\n|---|---|\n| 2×4 stud wall (insulated) | R-13 to R-15 |\n| 2×6 stud wall (insulated) | R-19 to R-21 |\n| CMU block (uninsulated) | R-2 to R-3 |\n| CMU with foam fill | R-8 to R-12 |\n| Poured concrete 8" | R-1.35 |\n| Attic (code minimum) | R-38 to R-60 |\n\n**U-Factor** = 1 / R-Value\nLower U-Factor = better insulation.`,
  },
  {
    keywords: ['u-factor', 'u factor', 'window', 'glass', 'glazing', 'shgc'],
    answer: `**Window Performance**\n\n| Window Type | U-Factor | SHGC |\n|---|---|---|\n| Single pane | 1.04 | 0.86 |\n| Double pane | 0.47 | 0.56 |\n| Double pane Low-E | 0.30 | 0.25-0.40 |\n| Triple pane Low-E | 0.18 | 0.22-0.35 |\n\n**SHGC** (Solar Heat Gain Coefficient): 0 = no solar heat, 1 = full solar heat.\n- Hot climates: lower SHGC (0.25) reduces cooling load\n- Cold climates: higher SHGC (0.40+) allows passive solar heating`,
  },
  {
    keywords: ['cfm', 'airflow', 'duct', 'duct size', 'air flow'],
    answer: `**CFM & Duct Sizing (Manual D)**\n\n**Rules of thumb:**\n- ~400 CFM per ton of cooling\n- ~1 CFM per sq ft for residential\n\n**Duct sizing by CFM:**\n| CFM | Round Duct | Rectangular |\n|---|---|---|\n| 100 | 6" | 8×6 |\n| 200 | 8" | 10×8 |\n| 400 | 10" | 12×10 |\n| 600 | 12" | 14×10 |\n| 800 | 14" | 16×12 |\n\n**Velocity limits:** 600-900 FPM for residential trunks, 400-600 FPM for branches.\n\nUse Manual D for proper friction rate and equivalent length calculations.`,
  },
  {
    keywords: ['tonnage', 'tons', 'equipment', 'unit size', 'sizing', 'btu'],
    answer: `**Equipment Sizing (Manual S)**\n\n**Cooling:** 1 ton = 12,000 BTU/h\n\n**Quick sizing:**\n| Home Size | Climate Zone | Approx. Tons |\n|---|---|---|\n| 1,000 sq ft | Moderate | 1.5 - 2.0 |\n| 1,500 sq ft | Moderate | 2.0 - 2.5 |\n| 2,000 sq ft | Moderate | 2.5 - 3.0 |\n| 2,500 sq ft | Moderate | 3.0 - 3.5 |\n| 3,000 sq ft | Moderate | 3.5 - 4.0 |\n\n**Important:** Never use sq ft rules of thumb for final sizing. Always use Manual J loads.\n\nOversizing causes: short cycling, poor dehumidification, higher cost.`,
  },
  {
    keywords: ['infiltration', 'air leakage', 'ach', 'blower door'],
    answer: `**Infiltration & Air Leakage**\n\n**ACH (Air Changes per Hour):**\n- Tight construction: 0.2 - 0.35 ACH\n- Average construction: 0.35 - 0.5 ACH\n- Loose construction: 0.5 - 1.0 ACH\n- Older homes: 1.0 - 2.0+ ACH\n\n**Blower door testing:**\n- ACH50 < 3.0 = tight house (code minimum many zones)\n- ACH50 < 1.0 = passive house territory\n\n**Manual J default:** If no blower door test, use construction quality estimate.\n\nInfiltration load = 1.08 × CFM × ΔT (sensible)\nInfiltration load = 0.68 × CFM × ΔW (latent)`,
  },
  {
    keywords: ['room', 'room size', 'area', 'detect'],
    answer: `**Room Detection & Area**\n\nThe CAD workspace can auto-detect rooms from your wall layout:\n\n1. Draw walls to form enclosed spaces\n2. Click the **Detect Rooms** tool (R) or click the scan icon in the toolbox\n3. The algorithm finds closed wall loops and calculates:\n   - Area in sq ft\n   - Perimeter in linear ft\n   - Room centroid for label placement\n\nDetected rooms appear as labeled overlays. Use these areas directly in Manual J for room-by-room load calculations.`,
  },
  {
    keywords: ['wall', 'draw wall', 'building', 'floor plan'],
    answer: `**Drawing Walls**\n\n1. Press **W** or select the Wall tool\n2. Click to start the first wall\n3. Move and click to place — walls chain automatically\n4. **Double-click** or **right-click** to end the chain\n5. Press **ESC** to cancel\n\n**Tips:**\n- Walls snap to a 1-foot grid by default\n- Close a room by clicking back on the starting point\n- Select a wall to edit its R-value, thickness, and material\n- Use the floor system to draw multi-story buildings`,
  },
  {
    keywords: ['design temp', 'outdoor', 'climate', 'temperature', 'heating degree'],
    answer: `**Design Temperatures**\n\nManual J uses 99% heating and 1% cooling design temps from ASHRAE data.\n\n**Example cities:**\n| City | Heating (99%) | Cooling (1%) |\n|---|---|---|\n| Phoenix, AZ | 38°F | 109°F |\n| Miami, FL | 47°F | 92°F |\n| Chicago, IL | -3°F | 93°F |\n| Denver, CO | 1°F | 93°F |\n| Seattle, WA | 26°F | 88°F |\n| New York, NY | 11°F | 93°F |\n\n**Indoor design:** 70°F heating / 75°F cooling (ACCA standard).\n\nΔT = Indoor temp − Outdoor design temp.`,
  },
];

function findAnswer(query: string): string {
  const q = query.toLowerCase();
  let bestMatch: KBEntry | null = null;
  let bestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(kw)) score += kw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && bestScore > 0) return bestMatch.answer;

  return `I can help with HVAC design questions. Try asking about:\n\n- **Manual J** load calculations\n- **R-values** and insulation\n- **Window U-factors** and SHGC\n- **CFM** and duct sizing\n- **Equipment tonnage** and sizing\n- **Infiltration** and air leakage\n- **Design temperatures** by city\n- **Wall drawing** and room detection\n\nType a question or click a quick topic below.`;
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
      { name: 'dt', label: 'Temp Difference', unit: '°F', default: 20 },
      { name: 'rval', label: 'Wall R-Value', unit: '', default: 19 },
    ],
    compute: (v) => {
      const uFactor = 1 / v.rval;
      const btu = v.area * uFactor * v.dt;
      return `Estimated wall heat transfer: **${btu.toFixed(0)} BTU/h**\n\nFormula: Area × U-Factor × ΔT = ${v.area} × ${uFactor.toFixed(4)} × ${v.dt}`;
    },
  },
  {
    id: 'cfm',
    label: 'CFM Calculator',
    icon: <Wind className="w-3.5 h-3.5" />,
    fields: [
      { name: 'tons', label: 'Cooling Tons', unit: 'tons', default: 3 },
    ],
    compute: (v) => {
      const cfm = v.tons * 400;
      return `Required airflow: **${cfm} CFM**\n\nRule of thumb: 400 CFM per ton of cooling.\n\nFor a ${v.tons}-ton system, you need approximately ${cfm} CFM total supply air.`;
    },
  },
  {
    id: 'duct',
    label: 'Duct Sizer',
    icon: <Calculator className="w-3.5 h-3.5" />,
    fields: [
      { name: 'cfm', label: 'CFM', unit: 'CFM', default: 200 },
      { name: 'velocity', label: 'Max Velocity', unit: 'FPM', default: 700 },
    ],
    compute: (v) => {
      const areaSqIn = (v.cfm / v.velocity) * 144;
      const diameter = Math.sqrt((4 * areaSqIn) / Math.PI);
      return `Minimum round duct: **${diameter.toFixed(1)}" diameter**\n\nDuct area needed: ${areaSqIn.toFixed(1)} sq in\n\nAt ${v.velocity} FPM for ${v.cfm} CFM.`;
    },
  },
];

// ── Chat message type ───────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Quick topic buttons ─────────────────────────────────────────────────────
const QUICK_TOPICS = [
  'Manual J basics',
  'R-value guide',
  'Window U-factors',
  'CFM & duct sizing',
  'Equipment tonnage',
  'Design temperatures',
  'How to draw walls',
  'Room detection',
];

export default function HvacAssistant() {
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
    const answer = findAnswer(query);

    // Add context from current drawing if relevant
    let contextNote = '';
    const state = useCadStore.getState();
    const floor = state.floors.find(f => f.id === state.activeFloorId);
    if (floor) {
      const wallCount = floor.walls.length;
      const roomCount = floor.rooms.length;
      const hvacCount = floor.hvacUnits.length;
      if (wallCount > 0 && (query.toLowerCase().includes('room') || query.toLowerCase().includes('area'))) {
        contextNote = `\n\n---\n*Your current floor "${floor.name}" has ${wallCount} walls, ${roomCount} detected rooms, and ${hvacCount} HVAC units.*`;
      }
    }

    const assistantMsg: ChatMessage = { role: 'assistant', content: answer + contextNote };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
  };

  const runCalc = (calc: QuickCalc) => {
    const result = calc.compute(calcValues);
    setMessages(prev => [
      ...prev,
      { role: 'user', content: `Calculate: ${calc.label}` },
      { role: 'assistant', content: result },
    ]);
    setActiveCalc(null);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="absolute bottom-6 right-20 z-20 p-3 rounded-full glass-panel border border-slate-700/50 backdrop-blur-xl bg-slate-900/70 text-slate-400 hover:text-amber-400 hover:border-amber-500/30 transition-all shadow-[0_0_30px_rgba(0,0,0,0.5)] group"
        aria-label="HVAC Expert Assistant"
      >
        <Zap className="w-5 h-5" />
        <div className="absolute right-full top-1/2 -translate-y-1/2 mr-3 px-3 py-1.5 bg-slate-800/90 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-md shadow-xl">
          HVAC Expert
          <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 bg-slate-800/90 border-r border-t border-slate-700 rotate-45" />
        </div>
      </button>
    );
  }

  return (
    <div className="absolute bottom-6 right-20 z-20 w-[400px] max-h-[75vh] glass-panel rounded-2xl flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.6)] border border-slate-700/50 backdrop-blur-xl bg-slate-900/80 overflow-hidden animate-in zoom-in-95 fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">HVAC Expert</h3>
          <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Manual J / D / S</span>
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
            <p className="text-xs text-slate-500 text-center">
              Ask anything about HVAC design, Manual J calculations, duct sizing, or equipment selection.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {QUICK_TOPICS.map(topic => (
                <button
                  key={topic}
                  onClick={() => handleSend(topic)}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all font-medium"
                >
                  {topic}
                </button>
              ))}
            </div>

            {/* Quick calculators */}
            <div className="pt-3 border-t border-slate-800/50">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold text-center mb-2">Quick Calculators</p>
              <div className="flex gap-2 justify-center">
                {quickCalcs.map(calc => (
                  <button
                    key={calc.id}
                    onClick={() => {
                      setActiveCalc(activeCalc === calc.id ? null : calc.id);
                      const defaults: Record<string, number> = {};
                      calc.fields.forEach(f => { defaults[f.name] = f.default; });
                      setCalcValues(defaults);
                    }}
                    className={`flex items-center gap-1.5 text-[10px] px-3 py-2 rounded-lg border font-semibold transition-all ${
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

              {/* Active calculator */}
              {activeCalc && (() => {
                const calc = quickCalcs.find(c => c.id === activeCalc);
                if (!calc) return null;
                return (
                  <div className="mt-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2 animate-in fade-in duration-200">
                    {calc.fields.map(field => (
                      <div key={field.name} className="flex items-center gap-2">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider w-28 flex-shrink-0">{field.label}</label>
                        <input
                          type="number"
                          value={calcValues[field.name] ?? field.default}
                          onChange={e => setCalcValues(prev => ({ ...prev, [field.name]: parseFloat(e.target.value) || 0 }))}
                          className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-500/50 transition-colors"
                        />
                        {field.unit && <span className="text-[10px] text-slate-600 w-10 flex-shrink-0">{field.unit}</span>}
                      </div>
                    ))}
                    <button
                      onClick={() => runCalc(calc)}
                      className="w-full mt-1 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-colors"
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
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200'
                : 'bg-slate-800/50 border border-slate-700/50 text-slate-300'
            }`}>
              {/* Simple markdown-ish rendering */}
              {msg.content.split('\n').map((line, j) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return <p key={j} className="font-bold text-slate-100 mb-1">{line.replace(/\*\*/g, '')}</p>;
                }
                if (line.startsWith('|')) {
                  return <p key={j} className="font-mono text-[10px] text-slate-400">{line}</p>;
                }
                if (line.startsWith('- ')) {
                  return <p key={j} className="pl-2">{'• '}{line.slice(2).replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
                }
                if (line.startsWith('---')) {
                  return <hr key={j} className="border-slate-700 my-2" />;
                }
                if (line.startsWith('*') && line.endsWith('*')) {
                  return <p key={j} className="text-slate-500 italic text-[10px]">{line.replace(/\*/g, '')}</p>;
                }
                if (line === '') return <br key={j} />;
                // Inline bold
                const parts = line.split(/\*\*(.*?)\*\*/g);
                return (
                  <p key={j}>
                    {parts.map((part, k) =>
                      k % 2 === 1 ? <strong key={k} className="text-slate-100">{part}</strong> : part
                    )}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Quick topics (shown when messages exist) */}
      {messages.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-800/50 flex-shrink-0">
          <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
            {QUICK_TOPICS.slice(0, 5).map(topic => (
              <button
                key={topic}
                onClick={() => handleSend(topic)}
                className="text-[9px] px-2 py-1 rounded-md bg-slate-800/40 border border-slate-700/40 text-slate-500 hover:text-emerald-400 transition-all whitespace-nowrap flex-shrink-0"
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
            placeholder="Ask about HVAC, Manual J, duct sizing..."
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
