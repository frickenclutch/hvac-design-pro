import { describe, it, expect } from 'vitest';
import { lookupByZip } from '../ashraeWeather';

describe('lookupByZip', () => {
  it('finds the station for a complete five-digit ZIP', () => {
    const r = lookupByZip('05401');
    expect(r.found).toBe(true);
    expect(r.city).toBe('Burlington');
    expect(r.state).toBe('VT');
  });

  it('accepts ZIP+4', () => {
    expect(lookupByZip('05401-1234').city).toBe('Burlington');
  });

  it('refuses an incomplete ZIP instead of matching its first three digits', () => {
    // "5401" is 05401 with the leading zero lost; it used to return Wausau, WI.
    expect(lookupByZip('5401').found).toBe(false);
    expect(lookupByZip('054').found).toBe(false);
    expect(lookupByZip('').found).toBe(false);
    expect(lookupByZip('abc').found).toBe(false);
    expect(lookupByZip('054011').found).toBe(false);
  });

  it('reports not-found for a prefix with no station', () => {
    expect(lookupByZip('00501').found).toBe(false);
  });
});
