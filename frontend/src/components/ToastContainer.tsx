import { createPortal } from 'react-dom';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToastStore, type ToastType } from '../stores/useToastStore';

const iconMap: Record<ToastType, { icon: typeof CheckCircle; color: string }> = {
  success: { icon: CheckCircle, color: 'text-emerald-400' },
  error:   { icon: XCircle,     color: 'text-red-400' },
  warning: { icon: AlertTriangle, color: 'text-amber-400' },
  info:    { icon: Info,         color: 'text-sky-400' },
};

const borderMap: Record<ToastType, string> = {
  success: 'border-emerald-500/30',
  error:   'border-red-500/30',
  warning: 'border-amber-500/30',
  info:    'border-sky-500/30',
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      role="alert"
      aria-live="polite"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none"
    >
      {toasts.map((t) => {
        const { icon: Icon, color } = iconMap[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm w-80 glass-panel rounded-xl border ${borderMap[t.type]} shadow-2xl px-4 py-3 flex items-start gap-3 animate-in slide-in-from-top-2 fade-in duration-200`}
          >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${color}`} />
            <p className="text-sm font-medium text-slate-200 flex-1 break-words">{t.message}</p>
            <button
              onClick={() => removeToast(t.id)}
              className="flex-shrink-0 p-0.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
