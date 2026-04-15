import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const MAX_TOASTS = 5;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const full: Toast = { ...toast, id };

    set((s) => {
      const next = [...s.toasts, full];
      // Evict oldest if over limit
      if (next.length > MAX_TOASTS) {
        const evicted = next.shift()!;
        const timer = timers.get(evicted.id);
        if (timer) { clearTimeout(timer); timers.delete(evicted.id); }
      }
      return { toasts: next };
    });

    // Auto-dismiss
    const timer = setTimeout(() => {
      get().removeToast(id);
    }, full.duration);
    timers.set(id, timer);
  },

  removeToast: (id) => {
    const timer = timers.get(id);
    if (timer) { clearTimeout(timer); timers.delete(id); }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// ── Standalone convenience functions (callable from non-React code) ───────────
export const toast = {
  success: (message: string, duration = 5000) =>
    useToastStore.getState().addToast({ type: 'success', message, duration }),
  error: (message: string, duration = 8000) =>
    useToastStore.getState().addToast({ type: 'error', message, duration }),
  warning: (message: string, duration = 8000) =>
    useToastStore.getState().addToast({ type: 'warning', message, duration }),
  info: (message: string, duration = 5000) =>
    useToastStore.getState().addToast({ type: 'info', message, duration }),
};

// Expose on window for manual testing in dev console
if (typeof window !== 'undefined') {
  (window as any).__toast = toast;
}
