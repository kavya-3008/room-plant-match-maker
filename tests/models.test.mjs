import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/plants.js';
import { buildPlantVoxels } from '../src/plantModels.js';

test('every plant builds a non-trivial voxel model within its cell footprint', () => {
  for (const p of PLANTS) {
    const v = buildPlantVoxels(p, 7);
    assert.ok(v.length > 20, p.id);
    for (const { x, y, z } of v) {
      assert.ok(Math.abs(x) <= 2 && Math.abs(z) <= 2, `${p.id} spills outside cell: ${x},${z}`);
      assert.ok(y >= -1 && y < 20, `${p.id} y=${y}`);
    }
  }
});

test('plant models are deterministic per seed', () => {
  const p = PLANTS[0];
  assert.deepEqual(buildPlantVoxels(p, 3), buildPlantVoxels(p, 3));
});

test('plant ids are unique and light ranges are valid', () => {
  assert.equal(new Set(PLANTS.map((p) => p.id)).size, PLANTS.length);
  for (const p of PLANTS) assert.ok(p.light[0] <= p.light[1] && p.light[0] >= 0 && p.light[1] <= 3);
});
