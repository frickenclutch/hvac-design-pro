// @vitest-environment jsdom
/**
 * resolveUnderlayMigration — the one code path in the blueprint work that
 * irreversibly rewrites PRE-EXISTING user drawings.
 *
 * Fabric v7 defaults an object's origin to its centre, but UnderlayImage.x/y
 * means the sheet's top-left everywhere else in the app. Drawings saved before
 * that fix are held back on load and the user is asked once. Choosing
 * "re-anchor" promises the sheet "stays exactly where you last saw it".
 *
 * The subtlety these tests pin down: Fabric rotates about the ORIGIN POINT, so
 * moving the origin from centre to top-left also moves the rotation pivot. A
 * plain axis-aligned half-size subtraction only holds the sheet still when
 * rotation === 0; for a rotated sheet it silently displaces it, and there is no
 * undo entry and no second prompt.
 *
 * The invariant under test is therefore geometric, not arithmetic: after
 * migration, re-deriving the rendered centre the way Fabric will
 * (topLeft + R(angle)·(w/2, h/2)) must land back on the sheet's original
 * stored point.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The store imports fabric at module scope purely for canvas work the migration
// never touches; stub it so this stays a pure logic test.
vi.mock('fabric', () => ({}));

import { useCadStore, type UnderlayImage, type Floor } from '../useCadStore';

const sheet = (over: Partial<UnderlayImage> = {}): UnderlayImage => ({
  id: 'u1',
  name: 'plan.pdf',
  dataUrl: 'data:image/png;base64,AA',
  x: 1000,
  y: 1000,
  width: 600,
  height: 400,
  rotation: 0,
  opacity: 1,
  locked: false,
  ...over,
});

/** Where Fabric will actually draw the centre, given a top-left anchor. */
function renderedCentre(u: UnderlayImage) {
  const t = (u.rotation * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  return {
    x: u.x + (u.width / 2) * cos - (u.height / 2) * sin,
    y: u.y + (u.width / 2) * sin + (u.height / 2) * cos,
  };
}

function seed(underlays: UnderlayImage[]) {
  const floor = {
    ...useCadStore.getState().floors[0],
    underlays,
  } as Floor;
  useCadStore.setState({
    floors: [floor],
    activeFloorId: floor.id,
    underlayMigration: { floorIds: [floor.id] } as never,
  });
}

const migrated = () => useCadStore.getState().floors[0].underlays![0];

beforeEach(() => {
  useCadStore.setState({ underlayMigration: null });
});

describe('resolveUnderlayMigration — re-anchor holds the sheet still', () => {
  it('keeps an unrotated sheet exactly where it was (plain half-size case)', () => {
    seed([sheet({ rotation: 0 })]);
    useCadStore.getState().resolveUnderlayMigration('reanchor');

    const u = migrated();
    // The long-standing behaviour, unchanged.
    expect(u.x).toBeCloseTo(700, 6);
    expect(u.y).toBeCloseTo(800, 6);
    // And it satisfies the invariant.
    expect(renderedCentre(u).x).toBeCloseTo(1000, 6);
    expect(renderedCentre(u).y).toBeCloseTo(1000, 6);
  });

  it('holds a rotated sheet still — the pivot moves with the origin', () => {
    seed([sheet({ rotation: 15 })]);
    useCadStore.getState().resolveUnderlayMigration('reanchor');

    const u = migrated();
    // A naive axis-aligned subtraction would give (700, 800) here, which puts
    // the sheet's centre at (938.0, 1070.8) — ~62 x 71 px off, about 1.6 x 1.8 ft
    // at the default 40 px/ft, against every wall traced on that sheet.
    expect(u.x).toBeCloseTo(761.98, 1);
    expect(u.y).toBeCloseTo(729.16, 1);
    expect(renderedCentre(u).x).toBeCloseTo(1000, 6);
    expect(renderedCentre(u).y).toBeCloseTo(1000, 6);
  });

  it('holds still across a full sweep of rotations, including negative', () => {
    for (const rotation of [0, 15, 30, 45, 90, 135, 180, 270, 359, -30, -90]) {
      seed([sheet({ rotation })]);
      useCadStore.getState().resolveUnderlayMigration('reanchor');

      const c = renderedCentre(migrated());
      expect(c.x).toBeCloseTo(1000, 6);
      expect(c.y).toBeCloseTo(1000, 6);
    }
  });

  it('migrates every sheet on the floor, not just the first', () => {
    seed([
      sheet({ id: 'a', rotation: 0 }),
      sheet({ id: 'b', rotation: 90, x: 200, y: 300, width: 800, height: 500 }),
    ]);
    useCadStore.getState().resolveUnderlayMigration('reanchor');

    const [a, b] = useCadStore.getState().floors[0].underlays!;
    expect(renderedCentre(a).x).toBeCloseTo(1000, 6);
    expect(renderedCentre(a).y).toBeCloseTo(1000, 6);
    expect(renderedCentre(b).x).toBeCloseTo(200, 6);
    expect(renderedCentre(b).y).toBeCloseTo(300, 6);
  });

  it('"keep" leaves coordinates untouched and clears the prompt', () => {
    seed([sheet({ rotation: 15 })]);
    useCadStore.getState().resolveUnderlayMigration('keep');

    const u = migrated();
    expect(u.x).toBe(1000);
    expect(u.y).toBe(1000);
    expect(useCadStore.getState().underlayMigration).toBeNull();
  });

  it('clears the prompt after re-anchoring so it is asked only once', () => {
    seed([sheet()]);
    useCadStore.getState().resolveUnderlayMigration('reanchor');
    expect(useCadStore.getState().underlayMigration).toBeNull();
  });
});
