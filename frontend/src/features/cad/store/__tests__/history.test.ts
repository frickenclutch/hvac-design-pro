// @vitest-environment jsdom
/**
 * Undo / redo coverage for CAD edits.
 *
 * The toolbar has always offered Undo and bound Ctrl+Z, but only ONE operation
 * ever recorded history — adding a wall — and it did so from the canvas rather
 * than the store. Placing a window, door, register, pipe, duct, fitting, label
 * or dimension recorded nothing, and *no deletion of any kind* recorded
 * anything, so Ctrl+Z could not bring back a mis-clicked delete.
 *
 * History is now recorded centrally in `updateActiveFloor`, which every
 * user-facing mutation funnels through. These tests pin that down per entity
 * type, both directions, and cover the two ways a naive implementation goes
 * wrong: consuming an undo slot for a no-op, and leaving a stale redo branch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fabric', () => ({}));

import { useCadStore } from '../useCadStore';
import type {
  WallSegment, Opening, HvacUnit, PipeSegment,
  DuctSegment, DuctFitting, Annotation,
} from '../useCadStore';

const wall = (id: string): WallSegment => ({
  id, x1: 0, y1: 0, x2: 100, y2: 0,
  thicknessIn: 3.5, rValue: 19, material: 'insulated_stud', fabricId: id,
});

const opening = (id: string, wallId: string): Opening => ({
  id, type: 'window', wallId, positionAlongWall: 0.5,
  widthIn: 36, heightIn: 48, uFactor: 0.3, shgc: 0.25, fabricId: id,
});

const hvac = (id: string): HvacUnit => ({
  id, type: 'supply_register', x: 10, y: 10, rotation: 0, cfm: 100, fabricId: id,
});

const pipe = (id: string): PipeSegment => ({
  id, x1: 0, y1: 0, x2: 50, y2: 0, diameterIn: 0.75,
  material: 'copper_liquid', fabricId: id,
});

const duct = (id: string): DuctSegment => ({
  id, x1: 0, y1: 0, x2: 80, y2: 0, shape: 'round', material: 'sheet_metal',
  side: 'supply', role: 'trunk', diameterIn: 12, fabricId: id,
});

const fitting = (id: string): DuctFitting => ({
  id, type: 'elbow_90', x: 5, y: 5, rotation: 0, shape: 'round',
  equivLengthFt: 15, fabricId: id,
});

const annotation = (id: string): Annotation => ({
  id, type: 'label', x: 1, y: 1, text: 'Label', fabricId: id,
});

const active = () => {
  const s = useCadStore.getState();
  return s.floors.find(f => f.id === s.activeFloorId)!;
};
const depths = () => {
  const s = useCadStore.getState();
  return { undo: s.undoStack.length, redo: s.redoStack.length };
};

beforeEach(() => {
  const s = useCadStore.getState();
  useCadStore.setState({
    floors: s.floors.map(f => f.id === s.activeFloorId
      ? { ...f, walls: [], openings: [], hvacUnits: [], pipes: [],
          ductSegments: [], ductFittings: [], annotations: [], rooms: [], underlays: [] }
      : f),
    undoStack: [],
    redoStack: [],
  });
});

describe('undo/redo records every entity type', () => {
  const cases: Array<[string, () => void, () => number]> = [
    ['wall',       () => useCadStore.getState().addWall(wall('w1')),                () => active().walls.length],
    ['opening',    () => useCadStore.getState().addOpening(opening('o1', 'w1')),    () => active().openings.length],
    ['hvac unit',  () => useCadStore.getState().addHvacUnit(hvac('h1')),            () => active().hvacUnits.length],
    ['pipe',       () => useCadStore.getState().addPipe(pipe('p1')),                () => active().pipes.length],
    ['duct',       () => useCadStore.getState().addDuctSegment(duct('d1')),         () => active().ductSegments.length],
    ['fitting',    () => useCadStore.getState().addDuctFitting(fitting('f1')),      () => active().ductFittings.length],
    ['annotation', () => useCadStore.getState().addAnnotation(annotation('a1')),    () => active().annotations.length],
  ];

  for (const [name, add, count] of cases) {
    it(`undoes and redoes adding a ${name}`, () => {
      expect(count()).toBe(0);
      add();
      expect(count()).toBe(1);
      expect(depths().undo).toBe(1);

      useCadStore.getState().undo();
      expect(count()).toBe(0);

      useCadStore.getState().redo();
      expect(count()).toBe(1);
    });
  }
});

describe('deletions are undoable', () => {
  it('restores a deleted register — the mis-click case that had no recovery', () => {
    useCadStore.getState().addHvacUnit(hvac('h1'));
    useCadStore.getState().addHvacUnit(hvac('h2'));
    expect(active().hvacUnits).toHaveLength(2);

    useCadStore.getState().removeHvacUnit('h1');
    expect(active().hvacUnits.map(h => h.id)).toEqual(['h2']);

    useCadStore.getState().undo();
    expect(active().hvacUnits.map(h => h.id).sort()).toEqual(['h1', 'h2']);
  });

  it('restores a deleted wall and its geometry intact', () => {
    useCadStore.getState().addWall(wall('w1'));
    useCadStore.getState().removeWall('w1');
    expect(active().walls).toHaveLength(0);

    useCadStore.getState().undo();
    expect(active().walls).toHaveLength(1);
    expect(active().walls[0]).toMatchObject({ id: 'w1', x2: 100, rValue: 19 });
  });
});

describe('stack discipline', () => {
  it('unwinds a mixed sequence one step at a time', () => {
    useCadStore.getState().addWall(wall('w1'));
    useCadStore.getState().addOpening(opening('o1', 'w1'));
    useCadStore.getState().addPipe(pipe('p1'));
    expect(depths().undo).toBe(3);

    useCadStore.getState().undo();
    expect(active().pipes).toHaveLength(0);
    expect(active().openings).toHaveLength(1);

    useCadStore.getState().undo();
    expect(active().openings).toHaveLength(0);
    expect(active().walls).toHaveLength(1);

    useCadStore.getState().undo();
    expect(active().walls).toHaveLength(0);
    expect(depths().undo).toBe(0);
  });

  it('does not consume a slot for a no-op edit', () => {
    useCadStore.getState().addWall(wall('w1'));
    const before = depths().undo;
    // Updating an id that is not present rewrites nothing.
    useCadStore.getState().updateWall('nope', { rValue: 30 });
    expect(depths().undo).toBe(before);
  });

  it('captures only the collections that changed', () => {
    useCadStore.getState().addWall(wall('w1'));
    useCadStore.getState().addPipe(pipe('p1'));
    const entry = useCadStore.getState().undoStack.at(-1)!;
    expect(Object.keys(entry.before)).toEqual(['pipes']);
    expect(Object.keys(entry.after)).toEqual(['pipes']);
  });

  it('a fresh edit invalidates the redo branch', () => {
    useCadStore.getState().addWall(wall('w1'));
    useCadStore.getState().undo();
    expect(depths().redo).toBe(1);

    useCadStore.getState().addPipe(pipe('p1'));
    expect(depths().redo).toBe(0);
  });

  it('undo on an empty stack is a no-op rather than a throw', () => {
    expect(() => useCadStore.getState().undo()).not.toThrow();
    expect(depths()).toEqual({ undo: 0, redo: 0 });
  });

  it('caps the stack instead of growing without bound', () => {
    for (let i = 0; i < 260; i++) useCadStore.getState().addWall(wall(`w${i}`));
    expect(depths().undo).toBeLessThanOrEqual(200);
    // The most recent edit is still the one undone first.
    useCadStore.getState().undo();
    expect(active().walls.some(w => w.id === 'w259')).toBe(false);
  });

  it('an update is undoable, not just add and remove', () => {
    useCadStore.getState().addWall(wall('w1'));
    useCadStore.getState().updateWall('w1', { rValue: 30 });
    expect(active().walls[0].rValue).toBe(30);

    useCadStore.getState().undo();
    expect(active().walls[0].rValue).toBe(19);
  });
});
