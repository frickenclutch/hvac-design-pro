import { create } from 'zustand';

export type ThemeMode = 'dark' | 'midnight' | 'light';
export type UIDensity = 'compact' | 'comfortable' | 'spacious';
export type UnitSystem = 'imperial' | 'metric';
export type AccentColor = 'emerald' | 'sky' | 'violet' | 'amber' | 'rose';

export interface UserPreferences {
  theme: ThemeMode;
  density: UIDensity;
  units: UnitSystem;
  accent: AccentColor;
  sidebarCollapsed: boolean;
  gridSnap: boolean;
  gridSpacing: number;       // px per foot
  defaultCeilingHeight: number;
  defaultWallRValue: number;
  defaultWindowUValue: number;
  showTooltips: boolean;
  autosave: boolean;
  animationsEnabled: boolean;
}

const STORAGE_KEY = 'hvac_preferences';

const defaults: UserPreferences = {
  theme: 'midnight',
  density: 'comfortable',
  units: 'imperial',
  accent: 'emerald',
  sidebarCollapsed: false,
  gridSnap: true,
  gridSpacing: 40,
  defaultCeilingHeight: 9,
  defaultWallRValue: 13,
  defaultWindowUValue: 0.5,
  showTooltips: true,
  autosave: true,
  animationsEnabled: true,
};

function load(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function persist(prefs: UserPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  applyTheme(prefs);
}

function applyTheme(prefs: UserPreferences) {
  const root = document.documentElement;

  // Accent color CSS vars
  const accents: Record<AccentColor, string> = {
    emerald: '16 185 129',
    sky: '14 165 233',
    violet: '139 92 246',
    amber: '245 158 11',
    rose: '244 63 94',
  };
  root.style.setProperty('--accent-rgb', accents[prefs.accent]);

  // Density
  const densityScale: Record<UIDensity, string> = {
    compact: '0.85',
    comfortable: '1',
    spacious: '1.15',
  };
  root.style.setProperty('--density-scale', densityScale[prefs.density]);

  // Theme class
  root.classList.remove('theme-dark', 'theme-midnight', 'theme-light');
  root.classList.add(`theme-${prefs.theme}`);

  // Animations
  if (!prefs.animationsEnabled) {
    root.classList.add('reduce-motion');
  } else {
    root.classList.remove('reduce-motion');
  }
}

interface PreferencesStore extends UserPreferences {
  update: (patch: Partial<UserPreferences>) => void;
  reset: () => void;
}

export const usePreferencesStore = create<PreferencesStore>((set) => {
  const initial = load();
  // Apply on first load
  setTimeout(() => applyTheme(initial), 0);

  return {
    ...initial,
    update: (patch) =>
      set((state) => {
        const next = { ...state, ...patch };
        persist(next);
        return next;
      }),
    reset: () =>
      set(() => {
        persist(defaults);
        return { ...defaults };
      }),
  };
});
