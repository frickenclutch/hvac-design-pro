import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, Pen, ArrowUpRight, Square, Type, EyeOff,
  Undo2, Trash2, X, Check, Loader2,
} from 'lucide-react';

/**
 * Screenshot annotation editor (MS-Paint-like) for feedback attachments.
 *
 * Built on Fabric.js — already the CAD engine — LAZY-loaded so it adds nothing
 * to the main bundle until a user actually annotates. Tools: select, freehand
 * pen, arrow, box, text, and a REDACT tool that lays an opaque block over a
 * region so client names / pricing / tokens can be scrubbed before the image
 * ever leaves the machine. On Done the canvas (background + annotations) is
 * flattened to a PNG File and handed back.
 */

// Minimal structural types for the lazily-imported Fabric surface we use. We
// avoid importing fabric's types at module scope so the dep stays out of the
// main chunk; `unknown`-y shapes are fine for this self-contained editor.
type FabricNS = typeof import('fabric');
type FabricCanvas = InstanceType<FabricNS['Canvas']>;
type FabricObject = InstanceType<FabricNS['Rect']>;

type Tool = 'select' | 'pen' | 'arrow' | 'box' | 'text' | 'redact';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#0f172a'];
const REDACT_FILL = '#0f172a';
const MAX_W = 1100;
const MAX_H = 660;

interface Props {
  imageDataUrl: string;
  onDone: (file: File) => void;
  onCancel: () => void;
}

export default function FeedbackAnnotator({ imageDataUrl, onDone, onCancel }: Props) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricNS | null>(null);
  const canvasRef = useRef<FabricCanvas | null>(null);
  const toolRef = useRef<Tool>('select');
  const colorRef = useRef<string>(COLORS[0]);
  const widthRef = useRef<number>(4);
  const undoStackRef = useRef<FabricObject[]>([]);

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { widthRef.current = strokeWidth; }, [strokeWidth]);

  // ── Setup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let canvas: FabricCanvas | null = null;

    (async () => {
      const fabric = await import('fabric');
      if (disposed || !canvasElRef.current) return;
      fabricRef.current = fabric;

      // Decode the capture to get its native size, then fit within MAX_W/MAX_H.
      const imgEl = new Image();
      imgEl.src = imageDataUrl;
      try { await imgEl.decode(); } catch { /* fall through — width/height may be 0 */ }
      const iw = imgEl.naturalWidth || MAX_W;
      const ih = imgEl.naturalHeight || MAX_H;
      const scale = Math.min(MAX_W / iw, MAX_H / ih, 1);
      const w = Math.round(iw * scale);
      const h = Math.round(ih * scale);

      canvas = new fabric.Canvas(canvasElRef.current, {
        width: w, height: h, selection: true, backgroundColor: '#0f172a',
      });
      canvasRef.current = canvas;

      const bg = new fabric.FabricImage(imgEl, {
        selectable: false, evented: false, scaleX: scale, scaleY: scale,
      });
      canvas.backgroundImage = bg;
      canvas.renderAll();

      wireTools(fabric, canvas);
      if (!disposed) setReady(true);
    })();

    return () => {
      disposed = true;
      try { canvas?.dispose(); } catch { /* ignore */ }
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl]);

  // ── Tool wiring (drag-to-draw shapes + click-to-type text) ───────────────
  const wireTools = (fabric: FabricNS, canvas: FabricCanvas) => {
    let drawing: FabricObject | null = null;
    let startX = 0, startY = 0;

    const pushUndo = (obj: FabricObject) => { undoStackRef.current.push(obj); };

    const arrowPath = (x1: number, y1: number, x2: number, y2: number) => {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(12, widthRef.current * 3);
      const a1 = ang + Math.PI - Math.PI / 7;
      const a2 = ang + Math.PI + Math.PI / 7;
      const hx1 = x2 + head * Math.cos(a1), hy1 = y2 + head * Math.sin(a1);
      const hx2 = x2 + head * Math.cos(a2), hy2 = y2 + head * Math.sin(a2);
      return `M ${x1} ${y1} L ${x2} ${y2} M ${x2} ${y2} L ${hx1} ${hy1} M ${x2} ${y2} L ${hx2} ${hy2}`;
    };

    canvas.on('mouse:down', (opt) => {
      const t = toolRef.current;
      if (t === 'select') return;
      const p = canvas.getScenePoint(opt.e);
      startX = p.x; startY = p.y;

      if (t === 'text') {
        const text = new fabric.IText('Text', {
          left: startX, top: startY, fill: colorRef.current,
          fontSize: Math.max(18, widthRef.current * 6), fontFamily: 'sans-serif',
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        pushUndo(text as unknown as FabricObject);
        toolRef.current = 'select';
        setTool('select');
        return;
      }

      if (t === 'box') {
        drawing = new fabric.Rect({
          left: startX, top: startY, width: 1, height: 1,
          fill: 'transparent', stroke: colorRef.current, strokeWidth: widthRef.current,
        }) as unknown as FabricObject;
      } else if (t === 'redact') {
        drawing = new fabric.Rect({
          left: startX, top: startY, width: 1, height: 1,
          fill: REDACT_FILL, stroke: '', opacity: 1,
        }) as unknown as FabricObject;
      } else if (t === 'arrow') {
        drawing = new fabric.Path(arrowPath(startX, startY, startX, startY), {
          fill: '', stroke: colorRef.current, strokeWidth: widthRef.current,
          strokeLineCap: 'round', strokeLineJoin: 'round',
        }) as unknown as FabricObject;
      }
      if (drawing) { canvas.add(drawing); }
    });

    canvas.on('mouse:move', (opt) => {
      if (!drawing) return;
      const p = canvas.getScenePoint(opt.e);
      const t = toolRef.current;
      if (t === 'box' || t === 'redact') {
        const rect = drawing as unknown as InstanceType<FabricNS['Rect']>;
        rect.set({
          left: Math.min(startX, p.x), top: Math.min(startY, p.y),
          width: Math.abs(p.x - startX), height: Math.abs(p.y - startY),
        });
      } else if (t === 'arrow') {
        canvas.remove(drawing);
        drawing = new fabric.Path(arrowPath(startX, startY, p.x, p.y), {
          fill: '', stroke: colorRef.current, strokeWidth: widthRef.current,
          strokeLineCap: 'round', strokeLineJoin: 'round',
        }) as unknown as FabricObject;
        canvas.add(drawing);
      }
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (drawing) {
        // Discard degenerate (click-with-no-drag) shapes.
        const b = (drawing as unknown as FabricObject).getBoundingRect();
        if (b.width < 4 && b.height < 4) {
          canvas.remove(drawing);
        } else {
          pushUndo(drawing);
        }
        drawing = null;
      }
    });
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const applyTool = useCallback((t: Tool) => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;
    toolRef.current = t; // sync immediately — don't wait for the effect
    setTool(t);
    if (t === 'pen') {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = colorRef.current;
      brush.width = widthRef.current;
      canvas.freeDrawingBrush = brush;
    } else {
      canvas.isDrawingMode = false;
      canvas.selection = t === 'select';
    }
  }, []);

  const pickColor = useCallback((c: string) => {
    colorRef.current = c;
    setColor(c);
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.isDrawingMode && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = c;
    const active = canvas.getActiveObject();
    if (active) {
      if ('stroke' in active && (active as FabricObject).stroke) active.set('stroke', c);
      else active.set('fill', c);
      canvas.renderAll();
    }
  }, []);

  const pickWidth = useCallback((w: number) => {
    widthRef.current = w;
    setStrokeWidth(w);
    const canvas = canvasRef.current;
    if (canvas?.isDrawingMode && canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = w;
  }, []);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const obj = undoStackRef.current.pop();
    if (canvas && obj) { canvas.remove(obj); canvas.renderAll(); }
  }, []);

  const deleteSelected = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getActiveObjects().forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.renderAll();
  }, []);

  const finish = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    try {
      canvas.discardActiveObject();
      canvas.renderAll();
      const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      onDone(new File([blob], `screenshot-${ts}.png`, { type: 'image/png' }));
    } finally {
      setExporting(false);
    }
  }, [onDone]);

  // ── UI ───────────────────────────────────────────────────────────────────
  const ToolBtn = ({ t, icon, label }: { t: Tool; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => applyTool(t)}
      title={label}
      className={`p-2 rounded-lg transition-all min-w-[38px] min-h-[38px] flex items-center justify-center ${
        tool === t ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                   : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
      }`}
    >
      {icon}
    </button>
  );

  // Portal to <body>: Mason's panel uses backdrop-blur/transform, which would
  // otherwise become the containing block for this fixed overlay and confine
  // it to the panel instead of the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-panel rounded-2xl border border-slate-700/60 shadow-2xl overflow-hidden max-w-[95vw] max-h-[92vh] flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap p-3 border-b border-slate-800/60 bg-slate-900/50">
          <div className="flex items-center gap-1">
            <ToolBtn t="select" icon={<MousePointer2 className="w-4 h-4" />} label="Select / move" />
            <ToolBtn t="pen" icon={<Pen className="w-4 h-4" />} label="Freehand pen" />
            <ToolBtn t="arrow" icon={<ArrowUpRight className="w-4 h-4" />} label="Arrow" />
            <ToolBtn t="box" icon={<Square className="w-4 h-4" />} label="Box" />
            <ToolBtn t="text" icon={<Type className="w-4 h-4" />} label="Text" />
            <ToolBtn t="redact" icon={<EyeOff className="w-4 h-4" />} label="Redact (hide a region)" />
          </div>

          <div className="w-px h-6 bg-slate-700/60 mx-1" />

          {/* Colors */}
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => pickColor(c)}
                title={c}
                className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-slate-700 hover:border-slate-500'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <div className="w-px h-6 bg-slate-700/60 mx-1" />

          {/* Stroke width */}
          <div className="flex items-center gap-1">
            {[2, 4, 8].map((w) => (
              <button
                key={w}
                onClick={() => pickWidth(w)}
                title={`Stroke ${w}px`}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${strokeWidth === w ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400 hover:text-white border border-transparent'}`}
              >
                {w === 2 ? 'S' : w === 4 ? 'M' : 'L'}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-700/60 mx-1" />

          <button onClick={undo} title="Undo" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-w-[38px] min-h-[38px] flex items-center justify-center">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={deleteSelected} title="Delete selected" className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 min-w-[38px] min-h-[38px] flex items-center justify-center">
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-all">
              <X className="w-4 h-4" /> Cancel
            </button>
            <button onClick={finish} disabled={!ready || exporting} className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Attach
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative overflow-auto p-4 bg-slate-950/60 flex items-center justify-center" style={{ minHeight: 200 }}>
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading editor…
            </div>
          )}
          <canvas ref={canvasElRef} className="rounded-lg shadow-lg" />
        </div>

        <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-800/60 bg-slate-900/40">
          Draw arrows, boxes, and text to point out the issue. Use <span className="text-slate-300 font-semibold">Redact</span> to
          hide anything sensitive before it's sent. Click <span className="text-emerald-400 font-semibold">Attach</span> when done.
        </p>
      </div>
    </div>,
    document.body,
  );
}
