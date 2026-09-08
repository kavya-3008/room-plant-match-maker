import test from 'node:test';
import assert from 'node:assert/strict';
import { lampPPFD, lampDLI, planLamps, lightingAdvice } from '../src/growlight.js';
import { prepare, simulateYear } from '../src/daylight.js';
import { normalizeRoom } from '../src/floorplan.js';
import { PLANT_BY_ID } from '../src/plants.js';

test('Lambertian lamp: falls off with distance and conserves its photon flux', () => {
  assert.ok(lampPPFD(40, 0) > lampPPFD(40, 0.5) && lampPPFD(40, 0.5) > lampPPFD(40, 1.5));
  // Integrate E over the plane numerically; should recover PPF = watts × efficacy.
  let flux = 0;
  const dr = 0.001;
  for (let r = dr / 2; r < 60; r += dr) flux += lampPPFD(40, r) * 2 * Math.PI * r * dr;
  assert.ok(Math.abs(flux - 40 * 2.3) / (40 * 2.3) < 0.01, `flux ${flux}`);
});

test('lamp DLI under a 40 W lamp is in the range growers expect', () => {
  // ~118 µmol/m²/s directly below at 0.5 m, 12 h → ~5 mol/m²/day.
  const d = lampDLI(40, 0);
  assert.ok(d > 3 && d < 8, `${d}`);
});

const place = (plant, x, z, dli) => ({ plant, x, z, monthlyDli: new Array(12).fill(dli) });

test('no deficit, no lamp', () => {
  const room = normalizeRoom({ w: 8, d: 8, windows: [] });
  const plan = planLamps(room, [place(PLANT_BY_ID.snake, 1, 1, 5)]);
  assert.equal(plan.lamps.length, 0);
  assert.equal(plan.monthsNeeded.length, 0);
});

test('a dark corner gets a lamp right by the plant that covers its deficit', () => {
  const room = normalizeRoom({ w: 10, d: 10, windows: [] });
  const plan = planLamps(room, [place(PLANT_BY_ID.monstera, 1, 1, 1)]);
  assert.equal(plan.lamps.length, 1);
  const l = plan.lamps[0];
  assert.ok(Math.hypot(l.x - 1, l.z - 1) <= 1);
  assert.equal(plan.uncovered.length, 0);
  assert.ok(l.kWhPerYear > 0 && l.costPerYear > 0);
  assert.deepEqual(l.serves, ['Monstera']);
});

test('one lamp between two nearby needy plants beats two lamps', () => {
  const room = normalizeRoom({ w: 10, d: 10, windows: [] });
  const plan = planLamps(room, [place(PLANT_BY_ID.pothos, 2, 0, 1), place(PLANT_BY_ID.peace, 3, 0, 1)]);
  assert.equal(plan.lamps.length, 1);
});

test('with a one-lamp budget, the plant left out is reported with its own shortfall', () => {
  const room = normalizeRoom({ w: 16, d: 16, windows: [] });
  const pls = [place(PLANT_BY_ID.snake, 8, 8, 5), place(PLANT_BY_ID.monstera, 0, 0, 1), place(PLANT_BY_ID.fiddle, 15, 15, 1)];
  const plan = planLamps(room, pls, { maxLamps: 1 });
  assert.equal(plan.lamps.length, 1);
  assert.equal(plan.uncovered.length, 1);
  const left = plan.uncovered[0];
  const need = left.plant === 'Fiddle leaf fig' ? 8 - 1 : 5 - 1; // shortfall against the real minimum
  assert.ok(Math.abs(left.short - need) < 0.05, `${left.plant} short ${left.short}, expected ${need}`);
});

test('lamps are downsized to the smallest wattage that still works', () => {
  const room = normalizeRoom({ w: 6, d: 6, windows: [] });
  const plan = planLamps(room, [place(PLANT_BY_ID.castiron, 0, 0, 0.9)]); // needs only ~0.2 more
  assert.equal(plan.lamps[0].watts, 15);
});

test('a plant that only misses the safety margin is not reported as uncovered', () => {
  const room = normalizeRoom({ w: 16, d: 16, windows: [] });
  const plan = planLamps(room, [place(PLANT_BY_ID.monstera, 0, 0, 1), place(PLANT_BY_ID.pothos, 15, 15, 2.05)], { maxLamps: 1 });
  assert.ok(!plan.uncovered.some((u) => u.plant === 'Pothos'));
});

test('only the months that need it are counted for energy', () => {
  const room = normalizeRoom({ w: 6, d: 6, windows: [] });
  const dli = [1, 1, 3, 6, 8, 8, 8, 8, 6, 3, 1, 1];
  const plan = planLamps(room, [{ plant: PLANT_BY_ID.monstera, x: 0, z: 0, monthlyDli: dli }]);
  assert.deepEqual(plan.monthsNeeded, [0, 1, 2, 9, 10, 11]);
});

test('advice mentions lamps, scorch risk and a no-lamp case', () => {
  const room = normalizeRoom({ w: 10, d: 8, windows: [{ wall: 'S', pos: 3, width: 4 }] });
  const year = simulateYear(prepare(room), { lat: 32.7, cloud: 0 });
  const pl = { plant: PLANT_BY_ID.calathea, x: 4, z: 7, monthlyDli: year.months.map((m) => m.dli[4][7]) };
  const plan = planLamps(room, [pl]);
  const adv = lightingAdvice(room, year, [pl], plan);
  assert.ok(adv.some((a) => a.includes('sheer curtain')));
  const none = lightingAdvice(room, year, [], { lamps: [], uncovered: [], monthsNeeded: [] });
  assert.ok(none[0].includes('no grow lamp'));
});
