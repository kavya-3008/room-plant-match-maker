import test from 'node:test';
import assert from 'node:assert/strict';
import { lightFit, winterFactor, buildProblem, scoreLayout, greedyLayout, anneal, optimizePlacements, windowFrontCells } from '../src/optimizer.js';
import { prepare, simulateYear } from '../src/daylight.js';
import { normalizeRoom } from '../src/floorplan.js';
import { PLANTS, PLANT_BY_ID } from '../src/plants.js';

const room = normalizeRoom({ w: 10, d: 8, windows: [{ wall: 'S', pos: 3, width: 4 }, { wall: 'E', pos: 2, width: 2 }] });
const light = simulateYear(prepare(room), { lat: 32.7, cloud: 0.3 });

test('light fit peaks inside the range and falls off outside', () => {
  const p = PLANT_BY_ID.monstera; // 5-15
  const centre = Math.sqrt(5 * 15);
  assert.ok(Math.abs(lightFit(p, centre) - 1) < 1e-9);
  assert.ok(Math.abs(lightFit(p, 5) - 0.75) < 1e-9);
  assert.ok(lightFit(p, 2) < 0.2 && lightFit(p, 40) < 0.2);
  assert.ok(lightFit(p, 4) > lightFit(p, 3));
});

test('winter factor only bites when the darkest month is below the minimum', () => {
  const p = PLANT_BY_ID.monstera;
  assert.equal(winterFactor(p, 6), 1);
  assert.ok(winterFactor(p, 4) < 1 && winterFactor(p, 1) < winterFactor(p, 4));
  assert.ok(winterFactor(p, 0) >= 0.6);
});

test('window-front cells sit just inside each window', () => {
  const s = windowFrontCells(room);
  assert.ok(s.has('3,7') && s.has('6,6') && s.has('9,2') && !s.has('2,7'));
});

test('a plant in the wrong light scores worse than an empty slot', () => {
  const prob = buildProblem(room, light, [PLANT_BY_ID.barrel]);
  const darkest = prob.cells.reduce((b, c, i) => (c.dli < prob.cells[b].dli ? i : b), 0);
  assert.ok(scoreLayout(prob, [{ p: 0, c: darkest }]).total < scoreLayout(prob, []).total);
});

test('overlapping big plants are penalised', () => {
  const prob = buildProblem(room, light, [PLANT_BY_ID.monstera, PLANT_BY_ID.strelitzia]);
  const a = prob.cells.findIndex((c) => c.x === 4 && c.z === 7), b = prob.cells.findIndex((c) => c.x === 5 && c.z === 7);
  const far = prob.cells.findIndex((c) => c.x === 9 && c.z === 0);
  assert.ok(scoreLayout(prob, [{ p: 0, c: a }, { p: 1, c: b }]).terms.overlap < 0);
  assert.equal(scoreLayout(prob, [{ p: 0, c: a }, { p: 1, c: far }]).terms.overlap, 0);
});

test('annealing never does worse than its greedy start and is reproducible', () => {
  const prob = buildProblem(room, light, PLANTS);
  const g = scoreLayout(prob, greedyLayout(prob, 6)).total;
  const r1 = anneal(prob, { maxPlants: 6, seed: 7, iterations: 3000 });
  const r2 = anneal(prob, { maxPlants: 6, seed: 7, iterations: 3000 });
  assert.ok(r1.score >= g - 1e-9);
  assert.deepEqual(r1.layout, r2.layout);
});

test('optimised layouts respect preferences, uniqueness and the plant limit', () => {
  const { placements } = optimizePlacements(room, light, PLANTS, { pets: true, experience: 2, maxPlants: 5 }, { seed: 3, iterations: 2000 });
  assert.ok(placements.length > 0 && placements.length <= 5);
  assert.ok(placements.every((p) => p.plant.petSafe && p.plant.difficulty <= 2));
  assert.equal(new Set(placements.map((p) => p.plant.id)).size, placements.length);
  assert.equal(new Set(placements.map((p) => `${p.x},${p.z}`)).size, placements.length);
});

test('placed plants mostly sit in light they tolerate', () => {
  const { placements } = optimizePlacements(room, light, PLANTS, { maxPlants: 8 }, { seed: 11, iterations: 4000 });
  const ok = placements.filter((p) => p.dli >= p.plant.dli[0] * 0.8 && p.dli <= p.plant.dli[1] * 1.25);
  assert.ok(ok.length >= placements.length - 1, `${ok.length}/${placements.length} in range`);
});

test('sun-lovers end up brighter than shade plants', () => {
  const pool = [PLANT_BY_ID.echeveria, PLANT_BY_ID.aglaonema];
  const prob = buildProblem(room, light, pool);
  const res = anneal(prob, { maxPlants: 2, seed: 5, iterations: 2000 });
  const at = (id) => res.layout.find((e) => pool[e.p].id === id);
  const e = at('echeveria'), a = at('aglaonema');
  assert.ok(e && a);
  assert.ok(prob.cells[e.c].dli > prob.cells[a.c].dli);
});

test('furniture cells are never used and placements keep a walkway at the door', () => {
  const r = normalizeRoom({ ...room, furniture: [{ kind: 'sofa', x: 3, z: 6 }], doors: [{ wall: 'W', pos: 3, width: 2 }] });
  const l = simulateYear(prepare(r), { lat: 32.7 });
  const { placements } = optimizePlacements(r, l, PLANTS, { maxPlants: 8 }, { seed: 2, iterations: 1500 });
  for (const p of placements) {
    assert.ok(!(p.x >= 3 && p.x < 7 && p.z >= 6), 'under the sofa');
    assert.ok(!(p.x <= 1 && p.z >= 2 && p.z <= 5), 'in the doorway');
  }
  assert.ok(placements.every((p) => p.reasons.length >= 1));
});
