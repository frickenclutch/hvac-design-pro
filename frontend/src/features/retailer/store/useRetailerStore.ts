/**
 * Retailer Finder Store
 *
 * Manages geolocation, retailer search, cost estimation, and quote flow.
 */

import { create } from 'zustand';
import { ALL_RETAILERS } from '../data/retailers';
import { getUserLocation, sortRetailersByDistance, type RetailerWithDistance, type Coords } from '../utils/geolocation';
import { generateCostEstimate, type CostEstimate, type SystemType } from '../../../engines/costEstimator';
import type { WholeHouseResult, DesignConditions } from '../../../engines/manualJ';

interface RetailerState {
  // Panel visibility
  isOpen: boolean;
  open: () => void;
  close: () => void;

  // Geolocation
  userCoords: Coords | null;
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'error';
  locationError: string | null;
  requestLocation: () => Promise<void>;

  // Retailers
  retailers: RetailerWithDistance[];
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

export const useRetailerStore = create<RetailerState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  userCoords: null,
  locationStatus: 'idle',
  locationError: null,

  requestLocation: async () => {
    set({ locationStatus: 'requesting', locationError: null });
    try {
      const coords = await getUserLocation();
      const sorted = sortRetailersByDistance(ALL_RETAILERS, coords);
      set({
        userCoords: coords,
        locationStatus: 'granted',
        retailers: sorted,
        // Auto-select first preferred retailer
        selectedRetailer: sorted[0] ?? null,
      });
    } catch (err) {
      // Still show retailers, just without distance
      const sorted = sortRetailersByDistance(ALL_RETAILERS, null);
      set({
        locationStatus: 'denied',
        locationError: err instanceof Error ? err.message : 'Location unavailable',
        retailers: sorted,
        selectedRetailer: sorted[0] ?? null,
      });
    }
  },

  retailers: sortRetailersByDistance(ALL_RETAILERS, null),
  selectedRetailer: null,
  selectRetailer: (r) => set({ selectedRetailer: r }),

  costEstimate: null,
  systemType: 'heat_pump',

  setSystemType: (st: SystemType) => {
    set({ systemType: st });
    const { _cachedResult, _cachedConditions } = get();
    if (_cachedResult && _cachedConditions) {
      const estimate = generateCostEstimate(_cachedResult, _cachedConditions, st);
      set({ costEstimate: estimate });
    }
  },

  generateEstimate: (result, conditions) => {
    const { systemType } = get();
    const estimate = generateCostEstimate(result, conditions, systemType);
    set({
      costEstimate: estimate,
      _cachedResult: result,
      _cachedConditions: conditions,
    });
  },

  _cachedResult: null,
  _cachedConditions: null,
}));
