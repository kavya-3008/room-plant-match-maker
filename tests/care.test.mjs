import test from 'node:test';
import assert from 'node:assert/strict';
import {
  svp, vpd, potVolume, availableWater, dailyUse, simulatePot, feedingPlan, buildSchedule, toICS, icsEscape, icsFold, growingMonths,
  indoorClimate, defaultPot, utcDate,
} from '../src/care.js';
import { PLANT_BY_ID } from '../src/plants.js';

const ref = { dli: 5, tempC: 21, rh: 45, pot: { diameterCm: 15, mix: 'standard', material: 'plastic' }, growing: true };
const JUNE = utcDate(2026, 5, 1);
const climateRef = { temp: new Array(12).fill(21), rh: new Array(12).fill(45) };

test('vapour pressure physics', () => {
  assert.ok(Math.abs(svp(20) - 2.338) < 0.01, 'SVP at 20 °C ≈ 2.34 kPa');
  assert.ok(Math.abs(svp(0) - 0.6108) < 1e-6);
  assert.equal(vpd(25, 100), 0);
  assert.ok(vpd(28, 30) > vpd(20, 60));
});

test('pot volume and available water scale with the cube of diameter', () => {
  assert.ok(Math.abs(potVolume(15) - 2.39) < 0.02);
  assert.ok(Math.abs(availableWater(30) / availableWater(15) - 8) < 1e-9);
  assert.ok(availableWater(15, 'gritty') < availableWater(15, 'moisture'));
});

test('in reference conditions the model reproduces the catalogue interval', () => {
  for (const id of ['pothos', 'boston', 'snake', 'monstera', 'aloe', 'barrel']) {
    const p = PLANT_BY_ID[id];
    const pot = { ...defaultPot(p), diameterCm: 15, material: 'plastic' };
    const r = simulatePot({ plant: p, dli: 5 }, { start: JUNE, days: 120, lat: 35, climate: climateRef, pot });
    assert.ok(Math.abs(r.averageInterval - p.water) <= 1, `${id}: ${r.averageInterval} vs ${p.water}`);
  }
});

test('more light, drier air, terracotta and summer all mean more frequent watering', () => {
  const p = PLANT_BY_ID.pothos;
  const base = dailyUse(p, ref);
  assert.ok(dailyUse(p, { ...ref, dli: 12 }) > base);
  assert.ok(dailyUse(p, { ...ref, rh: 25, tempC: 26 }) > base);
  assert.ok(dailyUse(p, { ...ref, pot: { ...ref.pot, material: 'terracotta' } }) > base);
  assert.ok(dailyUse(p, { ...ref, growing: false }) < base);
});

test('succulents respond less to light than tropical foliage', () => {
  const ratio = (p) => dailyUse(p, { ...ref, dli: 15 }) / dailyUse(p, ref);
  assert.ok(ratio(PLANT_BY_ID.aloe) < ratio(PLANT_BY_ID.monstera));
});

test('a succulent in bright light still waters far less often than a fern', () => {
  const pot = (p) => ({ ...defaultPot(p), diameterCm: 15 }); // same pot size, each in its usual mix
  const aloe = simulatePot({ plant: PLANT_BY_ID.aloe, dli: 17 }, { start: JUNE, days: 120, climate: climateRef, pot: pot(PLANT_BY_ID.aloe) });
  const fern = simulatePot({ plant: PLANT_BY_ID.boston, dli: 6 }, { start: JUNE, days: 120, climate: climateRef, pot: pot(PLANT_BY_ID.boston) });
  assert.ok(aloe.averageInterval > 2 * fern.averageInterval, `aloe ${aloe.averageInterval} fern ${fern.averageInterval}`);
});

test('bigger pots dry out more slowly', () => {
  const p = PLANT_BY_ID.monstera;
  const small = simulatePot({ plant: p, dli: 6 }, { start: JUNE, days: 90, climate: climateRef, pot: { diameterCm: 12, mix: 'standard', material: 'plastic' } });
  const big = simulatePot({ plant: p, dli: 6 }, { start: JUNE, days: 90, climate: climateRef, pot: { diameterCm: 30, mix: 'standard', material: 'plastic' } });
  assert.ok(big.averageInterval > small.averageInterval);
});

test('chore days move waterings onto allowed weekdays without letting the pot run dry', () => {
  const p = PLANT_BY_ID.pothos;
  const r = simulatePot({ plant: p, dli: 5 }, { start: JUNE, days: 84, climate: climateRef, choreDays: [0, 3] }); // Sun, Wed
  assert.ok(r.events.length > 5);
  for (const e of r.events) {
    const wd = new Date(e.date + 'T00:00:00Z').getUTCDay();
    assert.ok(e.offSchedule || wd === 0 || wd === 3, `${e.date} is weekday ${wd}`);
  }
  assert.ok(r.events.filter((e) => e.offSchedule).length <= 1);
});

test('feeding happens only in the growing season, less often for slow growers', () => {
  const winter = feedingPlan({ plant: PLANT_BY_ID.pothos }, { start: utcDate(2026, 11, 1), days: 60, lat: 40 });
  assert.equal(winter.length, 0);
  const fast = feedingPlan({ plant: PLANT_BY_ID.pothos }, { start: utcDate(2026, 3, 1), days: 150, lat: 40 });
  const slow = feedingPlan({ plant: PLANT_BY_ID.snake }, { start: utcDate(2026, 3, 1), days: 150, lat: 40 });
  assert.ok(fast.length > slow.length && slow.every((f) => f.strength === 'half'));
  assert.deepEqual(growingMonths(-33), [8, 9, 10, 11, 0, 1, 2]);
});

test('southern-hemisphere climate is shifted by six months', () => {
  const n = indoorClimate(40), s = indoorClimate(-33);
  assert.equal(n.rh[0], s.rh[6]);
});

test('default pots: succulents get gritty mix, big plants get big pots', () => {
  assert.equal(defaultPot(PLANT_BY_ID.aloe).mix, 'gritty');
  assert.ok(defaultPot(PLANT_BY_ID.strelitzia).diameterCm > defaultPot(PLANT_BY_ID.haworthia).diameterCm);
});

test('room schedule merges plants by date', () => {
  const pls = [{ plant: PLANT_BY_ID.pothos, dli: 5 }, { plant: PLANT_BY_ID.boston, dli: 5 }];
  const s = buildSchedule(pls, { start: JUNE, days: 28, lat: 35, climate: climateRef });
  assert.ok(s.days.length > 0);
  const total = s.days.reduce((n, d) => n + d.water.length, 0);
  assert.equal(total, s.perPlant.reduce((n, p) => n + p.events.length, 0));
  assert.ok(s.days.every((d, i) => i === 0 || d.date > s.days[i - 1].date));
});

test('iCalendar text escaping and line folding follow RFC 5545', () => {
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const folded = icsFold(long).split('\r\n');
  assert.ok(folded.length === 3 && folded.every((l) => new TextEncoder().encode(l).length <= 75));
  assert.ok(folded.slice(1).every((l) => l.startsWith(' ')));
  assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(''), long);
  const emoji = icsFold('SUMMARY:' + '🌿'.repeat(40)).split('\r\n');
  assert.ok(emoji.every((l) => new TextEncoder().encode(l).length <= 75), 'never splits inside a multi-byte character');
});

test('ICS export is a valid calendar with one event per day', () => {
  const s = buildSchedule([{ plant: PLANT_BY_ID.pothos, dli: 5 }], { start: JUNE, days: 30, climate: climateRef });
  const ics = toICS(s, { stamp: new Date(Date.UTC(2026, 0, 1)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, s.days.length);
  assert.ok(/DTSTART;VALUE=DATE:2026\d{4}/.test(ics));
  assert.ok(ics.includes('DTSTAMP:20260101T000000Z'));
  assert.ok(!/[^\r]\n/.test(ics), 'all line breaks are CRLF');
});
