import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS, PLANT_BY_ID } from '../src/plants.js';

test('every plant record has complete, sane care data', () => {
  for (const p of PLANTS) {
    const at = `(${p.id})`;
    assert.ok(p.dli[0] > 0 && p.dli[0] < p.dli[1] && p.dli[1] <= 40, `dli ${at}`);
    assert.ok(p.water >= 1 && p.water <= 30, `water ${at}`);
    assert.ok(p.kc > 0 && p.kc <= 2, `kc ${at}`);
    assert.ok(p.dryFraction > 0 && p.dryFraction < 1, `dryFraction ${at}`);
    assert.ok(p.rhMin >= 10 && p.rhMin <= 80, `rhMin ${at}`);
    assert.ok(p.tempMin >= 0 && p.tempMin <= 20, `tempMin ${at}`);
    assert.ok(p.height > 0 && p.spread > 0, `size ${at}`);
    assert.ok([1, 2, 3].includes(p.difficulty), `difficulty ${at}`);
    assert.ok(['low', 'med', 'high'].includes(p.humidity), `humidity ${at}`);
    assert.equal(p.petSafe, p.toxin === null, `petSafe follows toxin ${at}`);
    assert.ok(p.tip.length > 20, `tip ${at}`);
  }
});

test('succulents dry out more and drink less than ferns', () => {
  const { aloe, boston, barrel, fittonia } = PLANT_BY_ID;
  assert.ok(aloe.dryFraction > boston.dryFraction && barrel.dryFraction > fittonia.dryFraction);
  assert.ok(aloe.kc < boston.kc && barrel.kc < fittonia.kc);
});

test('sun-lovers need more light than shade plants', () => {
  const { echeveria, barrel, castiron, aglaonema } = PLANT_BY_ID;
  assert.ok(Math.min(echeveria.dli[0], barrel.dli[0]) > Math.max(castiron.dli[1], aglaonema.dli[1]));
});

test('the catalogue offers pet-safe choices at every light level', () => {
  for (let c = 0; c <= 3; c++) assert.ok(PLANTS.some((p) => p.petSafe && p.light[0] <= c && c <= p.light[1]), `class ${c}`);
});
