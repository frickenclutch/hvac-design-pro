/**
 * US state geographic centroids (population-weighted approximations).
 *
 * Used to place a project by its ZIP-derived state so the retailer finder can
 * rank branches by approximate distance from the job site WITHOUT requiring
 * the browser's GPS. State granularity is deliberate: it is accurate enough to
 * answer "which branch is nearest?" and "is this job inside the branch
 * footprint?" — the two questions this feature actually asks — with zero risk
 * of fabricated point data. Phase 1 (per-org supplier records with real
 * geocodes) refines this to street-level.
 */

export interface LatLng { lat: number; lng: number }

export const STATE_CENTROIDS: Record<string, LatLng> = {
  AL: { lat: 32.8, lng: -86.8 }, AK: { lat: 64.2, lng: -149.5 }, AZ: { lat: 34.2, lng: -111.7 },
  AR: { lat: 34.9, lng: -92.4 }, CA: { lat: 37.2, lng: -119.4 }, CO: { lat: 39.0, lng: -105.5 },
  CT: { lat: 41.6, lng: -72.7 }, DE: { lat: 39.0, lng: -75.5 }, DC: { lat: 38.9, lng: -77.0 },
  FL: { lat: 28.6, lng: -82.4 }, GA: { lat: 32.6, lng: -83.4 }, HI: { lat: 20.3, lng: -156.4 },
  ID: { lat: 44.4, lng: -114.6 }, IL: { lat: 40.0, lng: -89.2 }, IN: { lat: 39.9, lng: -86.3 },
  IA: { lat: 42.0, lng: -93.5 }, KS: { lat: 38.5, lng: -98.4 }, KY: { lat: 37.5, lng: -85.3 },
  LA: { lat: 31.0, lng: -92.0 }, ME: { lat: 45.4, lng: -69.2 }, MD: { lat: 39.0, lng: -76.8 },
  MA: { lat: 42.3, lng: -71.8 }, MI: { lat: 44.3, lng: -85.4 }, MN: { lat: 46.3, lng: -94.3 },
  MS: { lat: 32.7, lng: -89.7 }, MO: { lat: 38.4, lng: -92.5 }, MT: { lat: 47.0, lng: -109.6 },
  NE: { lat: 41.5, lng: -99.8 }, NV: { lat: 39.3, lng: -116.6 }, NH: { lat: 43.7, lng: -71.6 },
  NJ: { lat: 40.1, lng: -74.7 }, NM: { lat: 34.4, lng: -106.1 }, NY: { lat: 42.9, lng: -75.6 },
  NC: { lat: 35.6, lng: -79.4 }, ND: { lat: 47.5, lng: -100.5 }, OH: { lat: 40.3, lng: -82.8 },
  OK: { lat: 35.6, lng: -97.5 }, OR: { lat: 44.0, lng: -120.6 }, PA: { lat: 40.9, lng: -77.8 },
  RI: { lat: 41.7, lng: -71.5 }, SC: { lat: 33.9, lng: -80.9 }, SD: { lat: 44.4, lng: -100.2 },
  TN: { lat: 35.9, lng: -86.4 }, TX: { lat: 31.5, lng: -99.3 }, UT: { lat: 39.3, lng: -111.7 },
  VT: { lat: 44.1, lng: -72.7 }, VA: { lat: 37.5, lng: -78.9 }, WA: { lat: 47.4, lng: -120.5 },
  WV: { lat: 38.6, lng: -80.6 }, WI: { lat: 44.6, lng: -89.9 }, WY: { lat: 43.0, lng: -107.6 },
};

/** Two-letter state → centroid, or null if unknown. */
export function stateCentroid(state: string | null | undefined): LatLng | null {
  if (!state) return null;
  return STATE_CENTROIDS[state.toUpperCase().trim()] ?? null;
}
