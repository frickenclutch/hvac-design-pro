import { useA11y } from './A11yProvider';
import { Eye, Zap, Type, Focus } from 'lucide-react';

interface A11yPanelProps {
  compact?: boolean;
}

export default function A11yPanel({ compact = false }: A11yPanelProps) {
  const { reducedMotion, highContrast, focusVisible, fontSize, setReducedMotion, setHighContrast, setFocusVisible, setFontSize } = useA11y();

  const toggleClass = "relative w-11 h-6 rounded-full transition-colors cursor-pointer";
  const dotClass = "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm";

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {!compact && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Eye className="w-4 h-4 text-emerald-400" />
            Accessibility
          </h3>
          <p className="text-xs text-slate-500 mt-1">Customize your experience for comfort and usability.</p>
        </div>
      )}

      {/* Reduced Motion */}
      <label className="flex items-center justify-between gap-3 cursor-pointer group" htmlFor="a11y-motion">
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
          <div>
            <span className="text-sm text-slate-200 font-medium">Reduce motion</span>
            {!compact && <p className="text-xs text-slate-500">Disable animations and transitions</p>}
          </div>
        </div>
        <button
          id="a11y-motion"
          role="switch"
          aria-checked={reducedMotion}
          onClick={() => setReducedMotion(!reducedMotion)}
          className={`${toggleClass} ${reducedMotion ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <span className={`${dotClass} ${reducedMotion ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* High Contrast */}
      <label className="flex items-center justify-between gap-3 cursor-pointer group" htmlFor="a11y-contrast">
        <div className="flex items-center gap-2.5">
          <Eye className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
          <div>
            <span className="text-sm text-slate-200 font-medium">High contrast</span>
            {!compact && <p className="text-xs text-slate-500">Increase color contrast for better visibility</p>}
          </div>
        </div>
        <button
          id="a11y-contrast"
          role="switch"
          aria-checked={highContrast}
          onClick={() => setHighContrast(!highContrast)}
          className={`${toggleClass} ${highContrast ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <span className={`${dotClass} ${highContrast ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Focus Indicators */}
      <label className="flex items-center justify-between gap-3 cursor-pointer group" htmlFor="a11y-focus">
        <div className="flex items-center gap-2.5">
          <Focus className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
          <div>
            <span className="text-sm text-slate-200 font-medium">Focus indicators</span>
            {!compact && <p className="text-xs text-slate-500">Show visible outlines on focused elements</p>}
          </div>
        </div>
        <button
          id="a11y-focus"
          role="switch"
          aria-checked={focusVisible}
          onClick={() => setFocusVisible(!focusVisible)}
          className={`${toggleClass} ${focusVisible ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <span className={`${dotClass} ${focusVisible ? 'translate-x-5' : ''}`} />
        </button>
      </label>

      {/* Font Size */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Type className="w-4 h-4 text-slate-400" />
          <div>
            <span className="text-sm text-slate-200 font-medium">Text size</span>
            {!compact && <p className="text-xs text-slate-500">Adjust base font size</p>}
          </div>
        </div>
        <div className="flex gap-1">
          {(['normal', 'large', 'x-large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => setFontSize(size)}
              aria-pressed={fontSize === size}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                fontSize === size
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
              }`}
            >
              {size === 'normal' ? 'A' : size === 'large' ? 'A+' : 'A++'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
