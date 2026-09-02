import test from 'node:test';
import assert from 'node:assert/strict';
import { lightAt, classOf, recommend, lightGrid, lightSummary, lightingPlan, careCalendar, ambientFromBrightness } from '../src/engine.js';

const room = { w: 10, d: 8, windows: [{ wall: 'S', pos: 3, width: 4 }] };

test('light falls off with distance from the window', () => {
  const near = lightAt(room, 4, 7), far = lightAt(room, 4, 0);
  assert.ok(near > far);
});

test('south windows admit more light than north', () => {
  const s = { w: 8, d: 8, windows: [{ wall: 'S', pos: 2, width: 4 }] };
  const n = { w: 8, d: 8, windows: [{ wall: 'N', pos: 2, width: 4 }] };
  assert.ok(lightAt(s, 3, 7) > lightAt(n, 3, 0));
});

test('classOf thresholds', () => {
  assert.deepEqual([0.1, 0.3, 0.6, 0.9].map(classOf), [0, 1, 2, 3]);
});

test('light classes sum to the whole floor', () => {
  const s = lightSummary(lightGrid(room));
  assert.equal(s.counts.reduce((a, b) => a + b), 80);
});

test('no windows means a fully dark room', () => {
  const s = lightSummary(lightGrid({ w: 5, d: 5, windows: [] }));
  assert.equal(s.counts[0], 25);
});

test('pet-safe preference excludes toxic plants', () => {
  const picks = recommend(room, { pets: true, maxPlants: 10 });
  assert.ok(picks.length > 0 && picks.every((p) => p.plant.petSafe));
});

test('beginner preference excludes hard plants', () => {
  const picks = recommend(room, { experience: 1, maxPlants: 10 });
  assert.ok(picks.every((p) => p.plant.difficulty === 1));
});

test('every plant sits in light it can tolerate, with spacing', () => {
  const picks = recommend(room, { maxPlants: 8 });
  for (const p of picks) assert.ok(p.lightClass >= p.plant.light[0] && p.lightClass <= p.plant.light[1]);
  for (let i = 0; i < picks.length; i++)
    for (let j = i + 1; j < picks.length; j++)
      assert.ok(Math.max(Math.abs(picks[i].x - picks[j].x), Math.abs(picks[i].z - picks[j].z)) >= 2);
});

test('maxPlants is respected and plants are unique', () => {
  const picks = recommend(room, { maxPlants: 3 });
  assert.ok(picks.length <= 3);
  assert.equal(new Set(picks.map((p) => p.plant.id)).size, picks.length);
});

test('dark room gets a grow lamp suggestion', () => {
  const plan = lightingPlan({ w: 10, d: 10, windows: [{ wall: 'N', pos: 0, width: 2 }] });
  assert.ok(plan.lamps.length === 1 && plan.lamps[0].watts >= 15);
});

test('bright room needs no lamp', () => {
  const plan = lightingPlan({ w: 6, d: 6, windows: [{ wall: 'S', pos: 0, width: 6 }, { wall: 'W', pos: 0, width: 6 }] });
  assert.equal(plan.lamps.length, 0);
});

test('care calendar waters each plant on its interval', () => {
  const cal = careCalendar([{ plant: { name: 'A', water: 7 } }], 28);
  assert.equal(cal.flat().length, 4);
});

test('ambient multiplier is clamped', () => {
  assert.equal(ambientFromBrightness(0), 0.5);
  assert.equal(ambientFromBrightness(1), 1.5);
});
