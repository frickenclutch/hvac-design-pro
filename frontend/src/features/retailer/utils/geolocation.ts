/**
 * Geolocation utilities — Browser Geolocation API wrapper + Haversine distance
 */

import type { RetailerLocation } from '../data/retailers';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * Request the user's current GPS position.
 * Returns a promise that resolves to { lat, lng } or rejects on denial/error.
 */
export function getUserLocation(timeout = 10000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('Location permission denied. Enable location access in your browser settings.'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('Location information is unavailable.'));
            break;
          case error.TIMEOUT:
            reject(new Error('Location request timed out.'));
            break;
          default:
            reject(new Error('An unknown geolocation error occurred.'));
        }
      },
      {
        enableHighAccuracy: false,
        timeout,
        maximumAge: 300000, // cache for 5 minutes
      }
    );
  });
}

/**
 * Haversine formula — distance in miles between two lat/lng coordinate pairs.
 */
export function haversineDistanceMiles(a: Coords, b: Coords): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface RetailerWithDistance extends RetailerLocation {
  distanceMiles: number | null;
}

/**
 * Sort retailers by:
 *  1. Priority (preferred = 0 always first)
 *  2. Within same priority tier, by distance ascending
 *
 * If userCoords is null (geolocation denied), distance is null and
 * retailers are sorted by priority then alphabetically.
 */
export function sortRetailersByDistance(
  retailers: RetailerLocation[],
  userCoords: Coords | null
): RetailerWithDistance[] {
  const withDist: RetailerWithDistance[] = retailers.map((r) => ({
    ...r,
    distanceMiles: userCoords
      ? Math.round(haversineDistanceMiles(userCoords, r.coordinates) * 10) / 10
      : null,
  }));

  return withDist.sort((a, b) => {
    // Priority first (lower = higher priority)
    if (a.priority !== b.priority) return a.priority - b.priority;

    // Within same priority, sort by distance (null = end)
    if (a.distanceMiles !== null && b.distanceMiles !== null) {
      return a.distanceMiles - b.distanceMiles;
    }
    if (a.distanceMiles === null && b.distanceMiles !== null) return 1;
    if (a.distanceMiles !== null && b.distanceMiles === null) return -1;

    // Fallback: alphabetical
    return a.name.localeCompare(b.name);
  });
}

/**
 * Generate a Google Maps directions URL to a retailer.
 */
export function getDirectionsUrl(retailer: RetailerLocation): string {
  const dest = encodeURIComponent(
    `${retailer.address.line1}, ${retailer.address.city}, ${retailer.address.state} ${retailer.address.zip}`
  );
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
