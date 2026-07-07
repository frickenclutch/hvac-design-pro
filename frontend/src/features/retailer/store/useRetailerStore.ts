/**
 * Retailer Finder Store
 *
 * Manages retailer ranking, cost estimation, and quote flow. The primary
 * distance reference is the PROJECT location (derived from the ZIP entered in
 * the calculator), not the browser's GPS — the retailer list should reflect
 * the job site, not wherever the person running the software happens to be.
 * GPS remains available as a manual override.
 */

import { create } from 'zustand';
import { ALL_RETAILERS } from '../data/retailers';
import { stateCentroid, type LatLng } from '../data/stateCentroids';
import { getUserLocation, sortRetailersByDistance, type RetailerWithDistance, type Coords } from '../utils/geolocation';
import { generateCostEstimate, type CostEstimate, type SystemType } from '../../../engines/costEstimator';
import type { WholeHouseResult, DesignConditions } from '../../../engines/manualJ';

/** A job within this many miles of a branch is treated as "in footprint"
 *  (a walk-in/local-delivery branch leads). Beyond it, the nationwide
 *  e-commerce channel leads instead. */
export const FOOTPRINT_RADIUS_MI = 100;

export interface ProjectLocation {
  zip: string;
  city: string;
  state: string;
}

interface RetailerState {
  // Panel visibility
  isOpen: boolean;
  open: () => void;
  close: () => void;

  // Project location (primary reference — from the calculator ZIP)
  projectLocation: ProjectLocation | null;
  projectCoords: LatLng | null;
  setProjectLocation: (loc: ProjectLocation | null) => void;

  // Geolocation (optional manual override)
  userCoords: Coords | null;
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'error';
  locationError: string | null;
  requestLocation: () => Promise<void>;

  // Retailers
  retailers: RetailerWithDistance[];
  nearest: RetailerWithDistance | null;
  /** True when the nearest branch is within FOOTPRINT_RADIUS_MI of the job. */
  inFootprint: boolean;
  selectedRetailer: RetailerWithDistance | null;
  selectRetailer: (r: RetailerWithDistance) => void;

  // Cost estimate
  costEstimate: CostEstimate | null;
  systemType: SystemType;
  setSystemType: (st: SystemType) => void;
  generateEstimate: (result: WholeHouseResult, conditions: DesignConditions) => void;

  // Cached calc results for re-estimation on system type change
  _cachedResult: WholeHouseResult | null;
  _cachedConditions: DesignConditions | null;
}

/** Re-rank retailers against a reference point and derive nearest + footprint. */
function rank(ref: LatLng | null): Pick<RetailerState, 'retailers' | 'nearest' | 'inFootprint'> {
  const sorted = sortRetailersByDistance(ALL_RETAILERS, ref);
  // Nearest by actual distance (sortRetailersByDistance keeps preferred-first,
  // then distance; with a single preferred tier the first IS the nearest).
  const withDist = sorted.filter((r) => r.distanceMiles !== null);
  const nearest = withDist.length > 0
    ? withDist.reduce((a, b) => (b.distanceMiles! < a.distanceMiles! ? b : a))
    : sorted[0] ?? null;
  const inFootprint = nearest?.distanceMiles != null && nearest.distanceMiles <= FOOTPRINT_RADIUS_MI;
  return { retailers: sorted, nearest, inFootprint };
}

export const useRetailerStore = create<RetailerState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  projectLocation: null,
  projectCoords: null,

  setProjectLocation: (loc) => {
    const coords = loc ? stateCentroid(loc.state) : null;
    const ranked = rank(coords ?? get().userCoords);
    set({
      projectLocation: loc,
      projectCoords: coords,
      ...ranked,
      selectedRetailer: ranked.nearest,
    });
  },

  userCoords: null,
  locationStatus: 'idle',
  locationError: null,

  requestLocation: async () => {
    set({ locationStatus: 'requesting', locationError: null });
    try {
      const coords = await getUserLocation();
      // GPS override takes precedence over the project state centroid when
      // the user explicitly asks for "near me".
      const ranked = rank(coords);
      set({ userCoords: coords, locationStatus: 'granted', ...ranked, selectedRetailer: ranked.nearest });
    } catch (err) {
      set({
        locationStatus: 'denied',
        locationError: err instanceof Error ? err.message : 'Location unavailable',
      });
    }
  },

  ...rank(null),
  selectedRetailer: null,
  selectRetailer: (r) => set({ selectedRetailer: r }),

  costEstimate: null,
  systemType: 'heat_pump',

  setSystemType: (st: SystemType) => {
    set({ systemType: st });
    const { _cachedResult, _cachedConditions } = get();
    if (_cachedResult && _cachedConditions) {
      const estimate = generateCostEstimate(_cachedResult, _cachedConditions, st, get().projectLocation?.state ?? null);
      set({ costEstimate: estimate });
    }
  },

  generateEstimate: (result, conditions) => {
    const { systemType, projectLocation } = get();
    const estimate = generateCostEstimate(result, conditions, systemType, projectLocation?.state ?? null);
    set({
      costEstimate: estimate,
      _cachedResult: result,
      _cachedConditions: conditions,
    });
  },

  _cachedResult: null,
  _cachedConditions: null,
}));
