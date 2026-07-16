import { create } from 'zustand';

// ── Next-best-action guidance ("glimmer") ────────────────────────────────────
// When a user completes an action, the next ideal tool in the workflow gets a
// subtle glimmer until it's clicked or the user picks a different action on
// the same surface. One hint at a time, ephemeral, never persisted.
//
// Hint ids are namespaced by surface (`cad_`, `mj_`) so a surface can clear
// its own hints without touching another page's.
export type GuidanceHint =
  | 'cad_calibrate_scale'   // blueprint imported → calibrate it
  | 'cad_draw_wall'         // scale calibrated → trace walls
  | 'cad_ai_extract'        // blueprint imported → optionally AI-extract
  | 'cad_detect_rooms'      // walls traced → detect rooms
  | 'mj_import_cad'         // rooms detected → import into Manual J
  | 'mj_calculate'          // rooms present → run the load calc
  | 'mj_find_retailer';     // results ready → estimate + find supplier

interface GuidanceState {
  hint: GuidanceHint | null;
  setHint: (hint: GuidanceHint) => void;
  /** Clear the active hint. Pass a surface prefix (e.g. 'cad_') to clear
   *  only hints belonging to that surface. */
  clearHint: (prefix?: string) => void;
}

export const useGuidanceStore = create<GuidanceState>((set, get) => ({
  hint: null,
  setHint: (hint) => set({ hint }),
  clearHint: (prefix) => {
    const current = get().hint;
    if (!current) return;
    if (!prefix || current.startsWith(prefix)) set({ hint: null });
  },
}));

/** className fragment for a hinted control — empty string when not hinted. */
export function glimmerClass(id: GuidanceHint, active: GuidanceHint | null): string {
  return active === id ? ' guidance-glimmer' : '';
}
