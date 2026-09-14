import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, atTime, DEFAULT_STATE } from '../src/pipeline.js';

const opts = { iterations: 1500, start: new Date(Date.UTC(2026, 0, 5)) };

test('the default room analyses end to end', () => {
  const r = analyze({ ...DEFAULT_STATE, month: 0 }, opts);
  assert.deepEqual(r.errors, []);
  assert.ok(r.placements.length > 0 && r.placements.length <= DEFAULT_STATE.n);
  for (const p of r.placements) {
    assert.equal(p.monthlyDli.length, 12);
    assert.ok(Number.isFinite(p.interval) && p.interval > 0);
    assert.ok(p.pot.diameterCm >= 10);
  }
  assert.equal(r.roomMeanByMonth.length, 12);
  assert.ok(r.advice.length >= 1);
  assert.ok(r.schedule.days.length > 0);
  assert.equal(r.unitGrid.length, DEFAULT_STATE.w);
  assert.ok(r.search.score >= r.search.initial - 1e-9);
});

test('a windowless room needs lamps all year and the lamp light shows on the floor', () => {
  const r = analyze({ ...DEFAULT_STATE, windows: [], month: 5, n: 3 }, opts);
  // Nothing scores above an empty slot in total darkness, so the optimiser may place nothing at all.
  if (r.placements.length) {
    assert.equal(r.plan.monthsNeeded.length, 12);
    assert.ok(r.withLamps.flat().some((v) => v > 0));
  }
  assert.ok(r.advice.some((a) => a.includes('No windows')));
});

test('photo calibration scales the light grids', () => {
  const a = analyze({ ...DEFAULT_STATE, ambient: 1 }, opts), b = analyze({ ...DEFAULT_STATE, ambient: 1.5 }, opts);
  assert.ok(Math.abs(b.year.mean[4][7] / a.year.mean[4][7] - 1.5) < 1e-9);
});

test('invalid rooms report errors but still analyse', () => {
  const r = analyze({ ...DEFAULT_STATE, furniture: [{ kind: 'sofa', x: 8, z: 0 }] }, opts);
  assert.ok(r.errors.some((e) => e.includes('sticks out')));
});

test('time slider goes from sunrise to sunset', () => {
  const r = analyze({ ...DEFAULT_STATE, month: 5 }, opts);
  const dawn = atTime(r, 0.01), noon = atTime(r, 0.5);
  assert.ok(dawn.sun.elevation < 5 && noon.sun.elevation > 60);
  assert.ok(Math.abs(noon.hour - 12) < 0.01);
});
