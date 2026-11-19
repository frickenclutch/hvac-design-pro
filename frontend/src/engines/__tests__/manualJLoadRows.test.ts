import { describe, it, expect } from 'vitest';
import { calculateWholeHouse, createDefaultConditions, createDefaultRoom, type RoomInput } from '../manualJ';
import { wholeHouseLoadRows } from '../manualJLoadRows';

const room = (i: number, over: Partial<RoomInput>): RoomInput => ({ ...createDefaultRoom(i), id: `r${i}`, name: `Room ${i}`, ...over });

const house = () => [
  room(0, { lengthFt: 20, widthFt: 15, exteriorWalls: 2, windowSqFt: 45, exposureDirection: 'S' }),
  room(1, { lengthFt: 15, widthFt: 12, exteriorWalls: 1, windowSqFt: 20, exposureDirection: 'N' }),
  room(2, { lengthFt: 14, widthFt: 12, exteriorWalls: 2, windowSqFt: 24, exposureDirection: 'W' }),
];

const total = (rows: ReturnType<typeof wholeHouseLoadRows>, pick: (r: ReturnType<typeof wholeHouseLoadRows>[number]) => number) =>
  rows.reduce((s, r) => s + pick(r), 0);

describe('wholeHouseLoadRows', () => {
  it('rows add up to the reported totals with attic ducts', () => {
    const conditions = { ...createDefaultConditions(), ductLocation: 'attic' as const, totalFloorArea: 648, numBedrooms: 2 };
    const wh = calculateWholeHouse(house(), conditions);
    const rows = wholeHouseLoadRows(wh);

    expect(total(rows, r => r.heatingBtu)).toBeCloseTo(wh.totalHeatingBtu, 6);
    expect(total(rows, r => r.coolingBtuSensible)).toBeCloseTo(wh.totalCoolingSensible, 6);
    expect(total(rows, r => r.coolingBtuLatent)).toBeCloseTo(wh.totalCoolingLatent, 6);
    expect(total(rows, r => r.coolingBtuTotal)).toBeCloseTo(wh.totalCoolingBtu, 6);

    const ducts = rows.find(r => r.key === 'ducts')!;
    expect(ducts.heatingBtu).toBeCloseTo(wh.ductLossHeating, 6);
    expect(ducts.coolingBtuTotal).toBeCloseTo(wh.ductLossCooling, 6);
    expect(ducts.heatingBtu).toBeGreaterThan(0);
  });

  it('ventilation row matches 1.08 x CFM x dT on both sides', () => {
    const conditions = { ...createDefaultConditions(), ductLocation: 'conditioned' as const, totalFloorArea: 648, numBedrooms: 2 };
    const wh = calculateWholeHouse(house(), conditions);
    const vent = wholeHouseLoadRows(wh).find(r => r.key === 'ventilation')!;
    const heatingDT = conditions.indoorHeatingTemp - conditions.outdoorHeatingTemp;
    const coolingDT = conditions.outdoorCoolingTemp - conditions.indoorCoolingTemp;
    expect(vent.heatingBtu).toBeCloseTo(1.08 * wh.ventilationCFM * heatingDT, 6);
    expect(vent.coolingBtuSensible).toBeCloseTo(1.08 * wh.ventilationCFM * coolingDT, 6);
    expect(vent.coolingBtuLatent).toBeCloseTo(wh.ventilationLatent, 6);
  });

  it('duct row is zero when ducts are in conditioned space', () => {
    const wh = calculateWholeHouse(house(), { ...createDefaultConditions(), ductLocation: 'conditioned' });
    const ducts = wholeHouseLoadRows(wh).find(r => r.key === 'ducts')!;
    expect(ducts.heatingBtu).toBeCloseTo(0, 6);
    expect(ducts.coolingBtuSensible).toBeCloseTo(0, 6);
    expect(ducts.coolingBtuLatent).toBeCloseTo(0, 6);
  });

  it('adds an AED row only when there is an excursion, and still foots', () => {
    // All glass on one west face fails AED
    const rooms = [room(0, { lengthFt: 20, widthFt: 15, exteriorWalls: 2, windowSqFt: 120, exposureDirection: 'W' })];
    const wh = calculateWholeHouse(rooms, { ...createDefaultConditions(), ductLocation: 'attic' });
    expect(wh.aed.excursion).toBeGreaterThan(0);
    const rows = wholeHouseLoadRows(wh);
    expect(rows.find(r => r.key === 'aed')!.coolingBtuSensible).toBeCloseTo(wh.aed.excursion, 6);
    expect(total(rows, r => r.coolingBtuSensible)).toBeCloseTo(wh.totalCoolingSensible, 6);

    const pass = calculateWholeHouse(house(), createDefaultConditions());
    if (pass.aed.excursion === 0) {
      expect(wholeHouseLoadRows(pass).some(r => r.key === 'aed')).toBe(false);
    }
  });
});
