import { describe, it, expect } from 'vitest';
import { isManualSPlaceholder, isManualDPlaceholder, isAedPlaceholder } from '../legacyPlaceholders';

const oldManualS = {
  loadsSource: 'manual', totalCoolingBtu: 36000, sensibleCoolingBtu: 27000, heatingBtu: 45000,
  coolTotalCap: 38000, coolSensCap: 28000, heatCap: 50000, coolingModel: '', ahriRef: '', heatingModel: '',
};

const oldManualD = {
  equipmentCfm: 1200, blowerEsp: 0.5, filterDrop: 0.1, coilDrop: 0.2,
  rooms: [{ roomName: 'Room 1', requiredCfm: 100, actualLengthFt: 20 }],
};

const oldAed = [
  { orientation: 'S', areaSqFt: 64, shgc: 0.25, interiorShading: 0.7 },
  { orientation: 'W', areaSqFt: 24, shgc: 0.25, interiorShading: 0.7 },
  { orientation: 'E', areaSqFt: 18, shgc: 0.25, interiorShading: 0.7 },
  { orientation: 'N', areaSqFt: 12, shgc: 0.25, interiorShading: 0.7 },
];

describe('legacy placeholder detection', () => {
  it('recognises the untouched forms older builds saved on open', () => {
    expect(isManualSPlaceholder(oldManualS)).toBe(true);
    expect(isManualDPlaceholder(oldManualD)).toBe(true);
    expect(isAedPlaceholder(oldAed)).toBe(true);
  });

  it('never matches data a user has touched', () => {
    expect(isManualSPlaceholder({ ...oldManualS, coolingModel: '24ACC636' })).toBe(false);
    expect(isManualSPlaceholder({ ...oldManualS, loadsSource: 'manual-j' })).toBe(false);
    expect(isManualSPlaceholder({ ...oldManualS, heatingBtu: 45001 })).toBe(false);

    expect(isManualDPlaceholder({ ...oldManualD, rooms: [{ roomName: 'Kitchen', requiredCfm: 100, actualLengthFt: 20 }] })).toBe(false);
    expect(isManualDPlaceholder({ ...oldManualD, rooms: [...oldManualD.rooms, ...oldManualD.rooms] })).toBe(false);
    expect(isManualDPlaceholder({ ...oldManualD, equipmentCfm: 1000 })).toBe(false);

    expect(isAedPlaceholder(oldAed.slice(0, 3))).toBe(false);
    expect(isAedPlaceholder(oldAed.map((g, i) => (i === 0 ? { ...g, areaSqFt: 60 } : g)))).toBe(false);
  });

  it('tolerates malformed input', () => {
    expect(isManualDPlaceholder({})).toBe(false);
    expect(isManualDPlaceholder({ rooms: 'x' })).toBe(false);
    expect(isAedPlaceholder(null)).toBe(false);
    expect(isManualSPlaceholder({})).toBe(false);
  });
});
