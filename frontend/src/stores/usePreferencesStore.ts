import { create } from 'zustand';
import { scopedKey } from '../utils/storage';

export type ThemeMode = 'dark' | 'midnight' | 'light';
export type UIDensity = 'compact' | 'comfortable' | 'spacious';
export type UnitSystem = 'imperial' | 'metric';
export type AccentColor = 'emerald' | 'sky' | 'violet' | 'amber' | 'rose';
/** Metallic finish for the Creation Portal + portal-styled surfaces (Settings).
 *  Each finish re-tints the brushed plate AND re-inks the engraved text so it
 *  stays legible to human and machine vision (contrast-picked per finish). */
export type MetalFinish = 'steel' | 'aluminum' | 'brass' | 'bronze' | 'galvanized' | 'copper' | 'cast-iron';
/** Manual J calculation engine selector.
 *  'legacy'   — production default, per-room aggregated math (`engines/manualJ.ts`).
 *  'manualJ8' — cert-grade Form J1 whole-house engine. Beta — opt-in. */
export type EngineVersion = 'legacy' | 'manualJ8';

export interface ToolboxPosition {
  x: number;   // px from left edge of viewport
  y: number;   // px from top edge of viewport
}

export interface PanelSizes {
  propertiesWidth: number;   // px — right-side property inspector
  propertiesScale: number;   // 0.7–1.25 scale factor for properties panel
  propertiesPos: ToolboxPosition | null; // null = docked right rail; set = free-floating island
  layersWidth: number;       // px — bottom-right layer manager
  layersScale: number;       // 0.7–1.25 scale factor for layers panel
  layersPos: ToolboxPosition | null;     // null = docked bottom-right; set = free-floating island
  toolboxScale: number;      // 0.75–1.25 scale factor for tool buttons
  toolboxPos: ToolboxPosition; // last floating position of the toolbox
  floorsPos: ToolboxPosition | null; // floors bar position — null = docked top-center
}

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  propertiesWidth: 320,
  propertiesScale: 1,
  propertiesPos: null,
  layersWidth: 320,
  layersScale: 1,
  layersPos: null,
  toolboxScale: 1,
  toolboxPos: { x: 24, y: -1 },  // y=-1 signals "auto-center vertically"
  floorsPos: null,
};

export interface UserPreferences {
  theme: ThemeMode;
  density: UIDensity;
  units: UnitSystem;
  accent: AccentColor;
  /** Finish for the Creation Portal + portal-styled Settings surfaces. */
  metalFinish: MetalFinish;
  /** Titles of Settings sections the user has collapsed (persisted so the
   *  workbench stays how they left it). */
  settingsCollapsed: string[];
  /** Last-open Settings category id — re-entry lands where you left off. */
  settingsLastCategory: string;
  /** Custom Settings category order (category ids, top→bottom). null = the
   *  registry's default order. Set from the Settings rail's arrange mode.
   *  Mirrors the CAD toolbox's `toolboxOrder`. */
  settingsNavOrder: string[] | null;
  /** Settings categories hidden from the rail (ids). Still reachable via
   *  search and deep-links — hiding declutters the rail, it never disables a
   *  category. Mirrors the CAD toolbox's `toolboxHidden`. */
  settingsNavHidden: string[];

  // ── L0 Platform Admin panel (mirrors the Settings rail contract) ──────────
  /** Auto-refresh interval (ms) for the admin panel's live telemetry sections.
   *  0 = manual only. Persisted so the operator's console stays how they left
   *  it — same "my workbench" rule as the Settings prefs. */
  adminAutoRefreshMs: number;
  /** Custom admin category order (ids, top→bottom). null = registry default.
   *  Set from the admin rail's arrange mode. Mirrors `settingsNavOrder`. */
  adminNavOrder: string[] | null;
  /** Admin categories hidden from the rail (ids). Still search-reachable —
   *  hiding declutters, never disables. Mirrors `settingsNavHidden`. */
  adminNavHidden: string[];
  /** Last-open admin category id — re-entry lands where you left off. */
  adminLastCategory: string;

  sidebarCollapsed: boolean;
  gridSnap: boolean;
  gridSpacing: number;       // px per foot
  defaultCeilingHeight: number;
  defaultWallRValue: number;
  defaultWindowUValue: number;
  showTooltips: boolean;
  autosave: boolean;
  animationsEnabled: boolean;

  // CAD panel sizing
  panelSizes: PanelSizes;

  /** Custom toolbox tool order (rail ids, top→bottom). null = default
   *  grouped layout. Set from the toolbox's arrange mode. */
  toolboxOrder: string[] | null;
  /** Tools removed from the rail (still available in arrange mode's hidden
   *  tray, and via keyboard shortcuts — hiding declutters, never disables). */
  toolboxHidden: string[];

  // PDF & Print Customization
  pdfIncludeDrawing: boolean;
  pdfIncludeRoomSchedule: boolean;
  pdfIncludeOpeningSchedule: boolean;
  pdfIncludeLoadSummary: boolean;
  pdfIncludeNotes: boolean;
  pdfWatermarkText: string;
  pdfPageSize: 'letter' | 'a4' | 'tabloid';
  pdfOrientation: 'landscape' | 'portrait';

  // User avatar — a base64 data URL that represents this user throughout the
  // platform (avatar menu, sidebar, Creation Portal). Same storage contract as
  // the firm/PE stamps below: per-user scoped, quota-managed. Editable before
  // upload with the platform's own annotation tool (FeedbackAnnotator).
  avatarDataUrl: string;

  // Firm / Notary Stamps
  firmStampDataUrl: string;
  firmStampPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  notaryStampDataUrl: string;

  // Professional Engineer (PE) attestation — drives the permit-ready
  // attestation/signature page on combined reports. The attestation page
  // renders ONLY when peName + peSignatureDataUrl are both populated.
  peName: string;                 // e.g. "John A. Smith, PE"
  peLicenseNumber: string;        // e.g. "M-12345"
  peJurisdiction: string;         // e.g. "Maryland"
  peSignatureDataUrl: string;     // Base64 signature image (same upload pattern as firmStampDataUrl)

  // Calculation engine (Manual J)
  engineVersion: EngineVersion;
  /** When true, the calculator runs the Manual J 8 engine alongside legacy
   *  on every calc and logs `[engine drift]` to console. Display still
   *  uses `engineVersion`. Phase-1 telemetry; safe to leave on. */
  shadowRunManualJ8: boolean;
}

const STORAGE_KEY = 'hvac_preferences';
const MIGRATION_FLAG = 'hvac_preferences_migrated_v2';

const defaults: UserPreferences = {
  theme: 'midnight',
  density: 'comfortable',
  units: 'imperial',
  accent: 'emerald',
  metalFinish: 'steel',
  settingsCollapsed: [],
  settingsLastCategory: '',
  settingsNavOrder: null,
  settingsNavHidden: [],
  adminAutoRefreshMs: 0,
  adminNavOrder: null,
  adminNavHidden: [],
  adminLastCategory: '',
  sidebarCollapsed: false,
  gridSnap: true,
  gridSpacing: 40,
  defaultCeilingHeight: 9,
  defaultWallRValue: 13,
  defaultWindowUValue: 0.5,
  showTooltips: true,
  autosave: true,
  animationsEnabled: true,
  panelSizes: { ...DEFAULT_PANEL_SIZES },
  toolboxOrder: null,
  toolboxHidden: [],
  pdfIncludeDrawing: true,
  pdfIncludeRoomSchedule: true,
  pdfIncludeOpeningSchedule: true,
  pdfIncludeLoadSummary: true,
  pdfIncludeNotes: true,
  pdfWatermarkText: 'GENERATED BY HVAC DESIGNPRO',
  pdfPageSize: 'letter',
  pdfOrientation: 'landscape',
  avatarDataUrl: '',
  firmStampDataUrl: '',
  firmStampPosition: 'bottom-right',
  notaryStampDataUrl: '',
  peName: '',
  peLicenseNumber: '',
  peJurisdiction: '',
  peSignatureDataUrl: '',
  engineVersion: 'legacy',
  shadowRunManualJ8: true,
};

/** The canonical default preferences, exported so the Settings "non-default
 *  only" filter can compare each live pref against its shipped default. */
export { defaults as preferenceDefaults };

function load(): UserPreferences {
  migrateUnscopedOrphan();
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    // Deep-merge panelSizes so new fields (e.g. toolboxPos) get defaults
    const panelSizes = { ...DEFAULT_PANEL_SIZES, ...(parsed.panelSizes ?? {}) };
    return { ...defaults, ...parsed, panelSizes };
  } catch {
    return defaults;
  }
}

/**
 * One-shot recovery for orphan unscoped `hvac_preferences` keys created
 * during the boot-window race (architecturally fixed in storage.ts via
 * synchronous session-user seed). On real-user machines an orphan can
 * already exist — most painfully a multi-megabyte one carrying stamp
 * data URLs uploaded during the race window — so this sweep merges what
 * it can rescue and frees the quota.
 *
 * Behaviour:
 *  - Guest (scopedKey returns the bare base key) → no-op; nothing to
 *    rescue and no flag namespace to mark.
 *  - Already migrated (per-user flag set) → no-op.
 *  - Orphan absent → just set the flag.
 *  - Orphan present, scoped absent → promote orphan to scoped key.
 *  - Both present → preserve scoped, but rescue stamp data URLs from
 *    the orphan into scoped only when scoped lacks them.
 *  - Always remove the orphan after processing.
 *
 * Bounded to a single run per user via `hvac_preferences_migrated_v2`.
 */
function migrateUnscopedOrphan(): void {
  try {
    const scoped = scopedKey(STORAGE_KEY);
    if (scoped === STORAGE_KEY) return; // guest — nothing to migrate

    const flagKey = scopedKey(MIGRATION_FLAG);
    if (localStorage.getItem(flagKey) === '1') return;

    const orphanRaw = localStorage.getItem(STORAGE_KEY);
    if (orphanRaw === null) {
      localStorage.setItem(flagKey, '1');
      return;
    }

    const scopedRaw = localStorage.getItem(scoped);
    if (scopedRaw === null) {
      // No scoped value yet — promote orphan as-is.
      try {
        localStorage.setItem(scoped, orphanRaw);
      } catch {
        // Quota — falling through to remove the orphan still frees space;
        // the user keeps in-memory defaults, which the next persist will
        // re-seed minus the heavy stamp blobs.
      }
    } else {
      // Both exist — preserve scoped, rescue stamps when missing.
      try {
        const orphan = JSON.parse(orphanRaw);
        const scopedObj = JSON.parse(scopedRaw);
        let changed = false;
        if (!scopedObj.firmStampDataUrl && orphan.firmStampDataUrl) {
          scopedObj.firmStampDataUrl = orphan.firmStampDataUrl;
          changed = true;
        }
        if (!scopedObj.notaryStampDataUrl && orphan.notaryStampDataUrl) {
          scopedObj.notaryStampDataUrl = orphan.notaryStampDataUrl;
          changed = true;
        }
        if (!scopedObj.peSignatureDataUrl && orphan.peSignatureDataUrl) {
          scopedObj.peSignatureDataUrl = orphan.peSignatureDataUrl;
          changed = true;
        }
        if (changed) {
          try {
            localStorage.setItem(scoped, JSON.stringify(scopedObj));
          } catch {
            // Merged blob exceeds quota — leave scoped untouched.
            // Removing the orphan below still frees the bulk of the space.
          }
        }
      } catch { /* corrupt orphan — drop it via removal below */ }
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(flagKey, '1');
  } catch {
    // Best-effort migration — never block boot. If localStorage is
    // unavailable or throws, the boot-time seed in storage.ts still
    // routes future reads/writes correctly.
  }
}

function persist(prefs: UserPreferences) {
  // Apply theme regardless of persistence outcome — the in-memory state must
  // always reflect what the user just clicked, even if writing to localStorage
  // fails (e.g. quota exceeded from stamp data URLs).
  applyTheme(prefs);
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(prefs));
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      // Retry without the heaviest fields (stamp data URLs are typically 1-3 MB
      // each as base64). User keeps the in-memory toggle they just made; the
      // stamps are dropped from persistence so future clicks don't re-throw.
      try {
        const slim: UserPreferences = { ...prefs, avatarDataUrl: '', firmStampDataUrl: '', notaryStampDataUrl: '', peSignatureDataUrl: '' };
        localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(slim));
        // eslint-disable-next-line no-console
        console.warn('[preferences] localStorage quota exceeded — dropped stamp images from persisted prefs.');
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[preferences] localStorage quota exceeded and slim retry failed — preferences will not persist this session.');
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[preferences] failed to persist:', err);
    }
  }
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

  // Metal finish — drives the portal-plate tint + engraved-ink CSS variables
  // (see index.css [data-metal="…"]). Text ink is contrast-picked per finish.
  root.dataset.metal = prefs.metalFinish ?? 'steel';

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
