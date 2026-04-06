import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface A11yPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  focusVisible: boolean;
  fontSize: 'normal' | 'large' | 'x-large';
  announcements: string[];
}

interface A11yContextValue extends A11yPreferences {
  setReducedMotion: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  setFocusVisible: (v: boolean) => void;
  setFontSize: (v: 'normal' | 'large' | 'x-large') => void;
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const A11yContext = createContext<A11yContextValue | null>(null);

export function useA11y() {
  const ctx = useContext(A11yContext);
  if (!ctx) throw new Error('useA11y must be used within A11yProvider');
  return ctx;
}

const STORAGE_KEY = 'hvac_a11y_prefs';

function loadPrefs(): Partial<A11yPreferences> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function savePrefs(prefs: Partial<A11yPreferences>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    reducedMotion: prefs.reducedMotion,
    highContrast: prefs.highContrast,
    focusVisible: prefs.focusVisible,
    fontSize: prefs.fontSize,
  }));
}

export default function A11yProvider({ children }: { children: ReactNode }) {
  const stored = loadPrefs();

  // Detect OS-level reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [reducedMotion, setReducedMotion] = useState(stored.reducedMotion ?? prefersReducedMotion);
  const [highContrast, setHighContrast] = useState(stored.highContrast ?? false);
  const [focusVisible, setFocusVisible] = useState(stored.focusVisible ?? true);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'x-large'>(stored.fontSize as any ?? 'normal');
  const [announcements, setAnnouncements] = useState<string[]>([]);
  const [liveRegionText, setLiveRegionText] = useState('');
  const [liveRegionPriority, setLiveRegionPriority] = useState<'polite' | 'assertive'>('polite');

  // Apply global CSS classes based on preferences
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('a11y-reduced-motion', reducedMotion);
    root.classList.toggle('a11y-high-contrast', highContrast);
    root.classList.toggle('a11y-focus-visible', focusVisible);
    root.classList.toggle('a11y-font-large', fontSize === 'large');
    root.classList.toggle('a11y-font-xlarge', fontSize === 'x-large');

    savePrefs({ reducedMotion, highContrast, focusVisible, fontSize });
  }, [reducedMotion, highContrast, focusVisible, fontSize]);

  // Listen for OS preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      if (!stored.reducedMotion) setReducedMotion(e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    setLiveRegionPriority(priority);
    // Clear then set to force re-announcement
    setLiveRegionText('');
    requestAnimationFrame(() => setLiveRegionText(message));
    setAnnouncements(prev => [...prev.slice(-9), message]);
  };

  return (
    <A11yContext.Provider value={{
      reducedMotion, highContrast, focusVisible, fontSize, announcements,
      setReducedMotion, setHighContrast, setFocusVisible, setFontSize, announce,
    }}>
      {children}

      {/* ARIA Live Regions for screen reader announcements */}
      <div
        role="status"
        aria-live={liveRegionPriority}
        aria-atomic="true"
        className="sr-only"
      >
        {liveRegionText}
      </div>
    </A11yContext.Provider>
  );
}
