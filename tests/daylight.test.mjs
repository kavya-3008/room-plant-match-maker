import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepare, simulateDay, simulateYear, instant, iam, dliClass, dliToUnit, segmentHitsBox, throughWindow, breC, splitFluxIRC, summarize,
} from '../src/daylight.js';
import { normalizeRoom, windowRect } from '../src/floorplan.js';

const south = { w: 10, d: 8, windows: [{ wall: 'S', pos: 3, width: 4 }] };
const LAT = 32.7;
const DEC = 355, JUN = 172;

test('incidence angle modifier is 1 at normal incidence and 0 at grazing', () => {
  assert.equal(iam(1), 1);
  assert.ok(iam(Math.cos(Math.PI / 3)) > 0.85 && iam(Math.cos(Math.PI / 3)) < 0.95);
  assert.equal(iam(0), 0);
  assert.equal(iam(0.05), 0);
});

test('DLI classes and unit mapping line up', () => {
  assert.deepEqual([1, 3, 7, 20].map(dliClass), [0, 1, 2, 3]);
  assert.equal(dliToUnit(2), 0.2);
  assert.equal(dliToUnit(10), 0.7);
  let prev = -1;
  for (let v = 0; v <= 40; v += 0.5) { const u = dliToUnit(v); assert.ok(u >= prev); prev = u; }
});

test('segment-box intersection', () => {
  const b = { x0: 1, x1: 2, y0: 0, y1: 1, z0: 1, z1: 2 };
  assert.ok(segmentHitsBox({ x: 0, y: 0.5, z: 1.5 }, { x: 3, y: 0.5, z: 1.5 }, b));
  assert.ok(!segmentHitsBox({ x: 0, y: 1.5, z: 1.5 }, { x: 3, y: 1.5, z: 1.5 }, b), 'passes over');
  assert.ok(!segmentHitsBox({ x: 0, y: 0.5, z: 1.5 }, { x: 0.9, y: 0.5, z: 1.5 }, b), 'stops short');
});

test('rays only leave through the window opening', () => {
  const r = normalizeRoom(south);
  const rect = windowRect(r, r.windows[0]);
  const P = { x: 2.5, y: 0.4, z: 3 };
  const up = Math.SQRT1_2;
  assert.ok(throughWindow(P, { x: 0, y: up * 0.6, z: Math.sqrt(1 - 0.18) }, rect), 'shallow ray hits glass');
  assert.equal(throughWindow(P, { x: 0, y: 0.99, z: Math.sqrt(1 - 0.98) }, rect), null, 'steep ray hits the wall above');
  assert.equal(throughWindow(P, { x: 0, y: 0.5, z: -0.866 }, rect), null, 'ray going away from the window');
});

test('light falls off with distance from the window', () => {
  const p = prepare(south);
  const { dli } = simulateDay(p, { n: JUN, lat: LAT });
  assert.ok(dli[4][7] > dli[4][4] && dli[4][4] > dli[4][0]);
  assert.ok(p.sky[4][7] > 5 * p.sky[4][0]);
});

test('winter sun reaches deeper into a south room than summer sun', () => {
  const p = prepare(south);
  const dec = simulateDay(p, { n: DEC, lat: LAT, cloud: 0 }), jun = simulateDay(p, { n: JUN, lat: LAT, cloud: 0 });
  assert.ok(dec.sunHours[4][3] > 0, 'December sun patch reaches mid-room');
  assert.equal(jun.sunHours[4][3], 0, 'June noon sun is too high to reach mid-room');
});

test('overcast can brighten a room that gets no direct sun (more diffuse sky)', () => {
  const p = prepare({ w: 8, d: 8, windows: [{ wall: 'N', pos: 2, width: 4 }] });
  const clear = simulateDay(p, { n: JUN, lat: LAT, cloud: 0 }).dli[3][1];
  const grey = simulateDay(p, { n: JUN, lat: LAT, cloud: 0.7 }).dli[3][1];
  assert.ok(grey > clear);
});

test('a room with no windows gets no light', () => {
  const p = prepare({ w: 5, d: 5, windows: [] });
  const { dli } = simulateDay(p, { n: JUN, lat: LAT });
  assert.ok(dli.flat().every((v) => v === 0));
});

test('north windows get no direct sun in a northern winter, but some sky light', () => {
  const p = prepare({ w: 8, d: 8, windows: [{ wall: 'N', pos: 2, width: 4 }] });
  const day = simulateDay(p, { n: DEC, lat: 40, cloud: 0 });
  assert.ok(day.sunHours.flat().every((h) => h === 0));
  assert.ok(day.dli[3][0] > 0.5);
});

test('the same window gets more light facing south than north', () => {
  const s = prepare({ w: 8, d: 8, windows: [{ wall: 'S', pos: 2, width: 4 }] });
  const n = prepare({ w: 8, d: 8, windows: [{ wall: 'S', pos: 2, width: 4 }], rotation: 180 });
  const a = summarize(simulateYear(s, { lat: 40 }).mean), b = summarize(simulateYear(n, { lat: 40 }).mean);
  assert.ok(a.mean > 1.5 * b.mean, `south ${a.mean} vs north ${b.mean}`);
});

test('the southern hemisphere mirrors it: north-facing glass is the sunny side', () => {
  const nWin = prepare({ w: 8, d: 8, windows: [{ wall: 'N', pos: 2, width: 4 }] });
  const sWin = prepare({ w: 8, d: 8, windows: [{ wall: 'S', pos: 2, width: 4 }] });
  const a = summarize(simulateYear(nWin, { lat: -33.9 }).mean).mean, b = summarize(simulateYear(sWin, { lat: -33.9 }).mean).mean;
  assert.ok(a > 1.5 * b);
});

test('an overhang removes high summer sun but keeps low winter sun', () => {
  const plain = prepare(south);
  const shaded = prepare({ ...south, windows: [{ ...south.windows[0], overhang: 0.8 }] });
  const sun = (p, n) => simulateDay(p, { n, lat: LAT, cloud: 0 }).sunHours.flat().reduce((a, b) => a + b, 0);
  assert.ok(sun(shaded, JUN) < 0.5 * sun(plain, JUN), 'summer');
  assert.ok(sun(shaded, DEC) > 0.6 * sun(plain, DEC), 'winter');
});

test('a building across the street blocks low sun', () => {
  const plain = prepare(south);
  const blocked = prepare({ ...south, windows: [{ ...south.windows[0], obstruction: 40 }] });
  const total = (p) => simulateDay(p, { n: DEC, lat: LAT, cloud: 0 }).dli.flat().reduce((a, b) => a + b, 0);
  assert.ok(total(blocked) < 0.5 * total(plain));
});

test('a tall bookshelf casts a shadow behind it; a low table barely does', () => {
  const shelf = prepare({ ...south, furniture: [{ kind: 'bookshelf', x: 4, z: 6, w: 2, d: 1 }] });
  const table = prepare({ ...south, furniture: [{ kind: 'tvstand', x: 4, z: 6, w: 2, d: 1 }] });
  const plain = prepare(south);
  const at = (p) => simulateDay(p, { n: DEC, lat: LAT, cloud: 0 }).dli[4][4];
  assert.ok(at(shelf) < 0.5 * at(plain));
  assert.ok(at(table) > 0.7 * at(plain));
});

test('clouds and curtains reduce light; low-E glass lets in less than single pane', () => {
  const base = prepare(south);
  // In December the low sun shines deep into a south room, so cloud cover costs a lot of light.
  const clear = summarize(simulateDay(base, { n: DEC, lat: LAT, cloud: 0 }).dli).mean;
  const cloudy = summarize(simulateDay(base, { n: DEC, lat: LAT, cloud: 0.9 }).dli).mean;
  assert.ok(cloudy < 0.6 * clear);
  const curtain = prepare({ ...south, windows: [{ ...south.windows[0], curtain: 0.5 }] });
  assert.ok(summarize(simulateDay(curtain, { n: JUN, lat: LAT }).dli).mean < 0.6 * summarize(simulateDay(base, { n: JUN, lat: LAT }).dli).mean);
  const single = prepare({ ...south, windows: [{ ...south.windows[0], glazing: 'single' }] });
  const lowE = prepare({ ...south, windows: [{ ...south.windows[0], glazing: 'lowE' }] });
  assert.ok(simulateDay(single, { n: JUN, lat: LAT }).dli[4][6] > simulateDay(lowE, { n: JUN, lat: LAT }).dli[4][6]);
});

test('sky configuration factor stays below the half-space limit', () => {
  const p = prepare({ w: 16, d: 16, windows: [{ wall: 'S', pos: 0, width: 16, sill: 0.4, head: 2.5 }] }, { height: 0.4 });
  // A vertical opening can show a horizontal receptor at most half its hemisphere (and τ < 1 cuts that further).
  assert.ok(p.sky.flat().every((f) => f >= 0 && f < 0.5));
});

test('split-flux IRC is a plausible daylight factor and scales with window area', () => {
  const small = splitFluxIRC(normalizeRoom({ w: 10, d: 10, windows: [{ wall: 'S', pos: 0, width: 2 }] }));
  const big = splitFluxIRC(normalizeRoom({ w: 10, d: 10, windows: [{ wall: 'S', pos: 0, width: 8 }] }));
  assert.ok(small > 0.1 && small < 3, `small ${small}`);
  assert.ok(big > 3 * small);
  assert.equal(breC(0), 39);
  assert.equal(breC(25), 28);
});

test('instant light is zero at night and the sunlit patch moves with the sun', () => {
  const p = prepare({ w: 8, d: 8, windows: [{ wall: 'E', pos: 2, width: 4 }, { wall: 'W', pos: 2, width: 4 }] });
  const night = instant(p, { n: JUN, hour: 2, lat: LAT });
  assert.ok(night.ppfd.flat().every((v) => v === 0));
  const am = instant(p, { n: JUN, hour: 8, lat: LAT, cloud: 0 }), pm = instant(p, { n: JUN, hour: 16, lat: LAT, cloud: 0 });
  const westHalf = (g) => g.slice(0, 4).flat().filter(Boolean).length, eastHalf = (g) => g.slice(4).flat().filter(Boolean).length;
  // The sun patch lies on the floor just inside the window the sun is shining through.
  assert.ok(eastHalf(am.sunlit) > 0 && westHalf(am.sunlit) === 0, 'morning: patch inside the east window');
  assert.ok(westHalf(pm.sunlit) > 0 && eastHalf(pm.sunlit) === 0, 'afternoon: patch inside the west window');
});

test('simulateYear aggregates min, max and mean per cell', () => {
  const y = simulateYear(prepare(south), { lat: LAT });
  assert.equal(y.months.length, 12);
  for (let x = 0; x < 10; x++) for (let z = 0; z < 8; z++) assert.ok(y.min[x][z] <= y.mean[x][z] && y.mean[x][z] <= y.max[x][z]);
});
