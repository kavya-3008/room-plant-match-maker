import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoom, wallFacing, compassLabel, windowRect, occupiedCells, doorClearance, plantableCells, validateRoom, furnitureBoxes, key, CELL_M,
} from '../src/floorplan.js';

const base = { w: 10, d: 8, windows: [{ wall: 'S', pos: 3, width: 4 }] };

test('normalizeRoom fills window defaults and clamps to the wall', () => {
  const r = normalizeRoom({ w: 6, d: 6, windows: [{ wall: 'N', pos: 5, width: 9 }] });
  const w = r.windows[0];
  assert.equal(w.width, 6);
  assert.equal(w.pos, 0);
  assert.equal(w.sill, 0.5);
  assert.equal(w.glazing, 'double');
});

test('room rotation turns wall facings', () => {
  assert.equal(wallFacing({ rotation: 0 }, 'S'), 180);
  assert.equal(wallFacing({ rotation: 45 }, 'S'), 225);
  assert.equal(wallFacing({ rotation: 300 }, 'N'), 300);
  assert.equal(compassLabel(225), 'SW');
  assert.equal(compassLabel(359), 'N');
});

test('windowRect places the opening on the right plane', () => {
  const r = normalizeRoom(base);
  const rect = windowRect(r, r.windows[0]);
  assert.equal(rect.axis, 'z');
  assert.equal(rect.plane, 8 * CELL_M);
  assert.deepEqual([rect.a0, rect.a1], [1.5, 3.5]);
  assert.deepEqual(rect.n, { x: 0, z: 1 });
});

test('furniture occupies its footprint and becomes a box', () => {
  const r = normalizeRoom({ ...base, furniture: [{ kind: 'bookshelf', x: 0, z: 0 }] });
  const occ = occupiedCells(r);
  assert.deepEqual([...occ].sort(), [key(0, 0), key(1, 0)]);
  const [b] = furnitureBoxes(r);
  assert.deepEqual([b.x0, b.x1, b.z0, b.z1, b.y1], [0, 1, 0, 0.5, 2.0]);
});

test('door clearance keeps a walkway in front of the door', () => {
  const r = normalizeRoom({ ...base, doors: [{ wall: 'W', pos: 3, width: 2 }] });
  const c = doorClearance(r);
  assert.ok(c.has(key(0, 3)) && c.has(key(1, 4)) && c.has(key(0, 2)) && c.has(key(0, 5)));
  assert.ok(!c.has(key(2, 3)));
});

test('plantable cells avoid furniture and doorways but include spots beside furniture', () => {
  const r = normalizeRoom({ ...base, furniture: [{ kind: 'table', x: 4, z: 3 }], doors: [{ wall: 'N', pos: 0, width: 2 }] });
  const cells = plantableCells(r);
  const has = (x, z) => cells.some((c) => c.x === x && c.z === z);
  assert.ok(!has(5, 4), 'under the table');
  assert.ok(has(3, 4), 'beside the table');
  assert.ok(!has(0, 0) && !has(1, 1), 'door clearance');
  assert.ok(has(9, 7), 'corner');
});

test('validateRoom reports overlaps and out-of-bounds pieces', () => {
  assert.deepEqual(validateRoom(normalizeRoom(base)), []);
  const bad = validateRoom({
    w: 6, d: 6,
    windows: [{ wall: 'N', pos: 0, width: 3, sill: 0.5, head: 2 }, { wall: 'N', pos: 2, width: 2, sill: 0.5, head: 2 }],
    doors: [{ wall: 'E', pos: 5, width: 2 }],
    furniture: [{ kind: 'sofa', x: 0, z: 0, w: 4, d: 2 }, { kind: 'desk', x: 3, z: 1, w: 3, d: 2 }],
  });
  assert.ok(bad.some((e) => e.includes('overlap on the N wall')));
  assert.ok(bad.some((e) => e.includes("past the wall's end")));
  assert.ok(bad.some((e) => e.includes('sofa and desk overlap')));
});

test('stacked windows (clerestory over a low window) are not an overlap', () => {
  const errs = validateRoom({ w: 6, d: 6, windows: [{ wall: 'S', pos: 0, width: 3, sill: 0.5, head: 1.5 }, { wall: 'S', pos: 0, width: 3, sill: 1.8, head: 2.4 }] });
  assert.deepEqual(errs, []);
});
