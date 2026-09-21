import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declination, equationOfTime, sunAt, sunTimes, solarPosition, airMass, clearSky, skyIrradiance, sunVector, dayOfYear, MONTH_REP_DAY,
} from '../src/solar.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('declination hits the solstices and equinoxes', () => {
  near(declination(172), 23.44, 0.3, 'June solstice');
  near(declination(355), -23.44, 0.3, 'December solstice');
  near(declination(80), 0, 0.6, 'March equinox');
  near(declination(266), 0, 0.8, 'September equinox');
});

test('equation of time has its known extremes', () => {
  // About -14 min in mid-February, +16 min in early November.
  near(equationOfTime(42), -14.2, 0.6, 'Feb');
  near(equationOfTime(307), 16.4, 0.6, 'Nov');
});

test('solar noon elevation is 90 - lat + declination', () => {
  for (const lat of [-33.9, 0, 32.7, 51.5]) {
    for (const n of [21, 172, 266, 355]) {
      const { elevation } = sunAt(n, 12, lat);
      near(elevation, 90 - Math.abs(lat - declination(n)), 0.01, `lat ${lat} n ${n}`);
    }
  }
});

test('noon sun is due south in the northern mid-latitudes and due north in the south', () => {
  near(sunAt(172, 12, 40).azimuth, 180, 1e-6);
  near(sunAt(172, 12, -33.9).azimuth % 360, 0, 1e-6);
});

test('morning sun is in the east, afternoon sun in the west, symmetric about noon', () => {
  const am = sunAt(80, 9, 32.7), pm = sunAt(80, 15, 32.7);
  assert.ok(am.azimuth > 90 && am.azimuth < 180);
  assert.ok(pm.azimuth > 180 && pm.azimuth < 270);
  near(am.azimuth + pm.azimuth, 360, 1e-6);
  near(am.elevation, pm.elevation, 1e-9);
});

test('sunrise on the equinox is near 6:00 and due east', () => {
  const n = 80;
  const t = sunTimes(n, 32.7);
  near(t.sunrise, 6, 0.05);
  near(sunAt(n, t.sunrise, 32.7).azimuth, 90, 0.8);
});

test('days are longer in summer and polar day/night are reported', () => {
  assert.ok(sunTimes(172, 51.5).dayLength > 16 && sunTimes(355, 51.5).dayLength < 8.5);
  assert.equal(sunTimes(172, 75).polar, 'day');
  assert.equal(sunTimes(355, 75).polar, 'night');
});

test('NOAA and Spencer agree on sun position over a year', () => {
  // San Diego, at apparent solar noon computed from the NOAA equation of time.
  const lat = 32.7, lon = -117.16;
  let worst = 0;
  for (let m = 0; m < 12; m++) {
    const n = MONTH_REP_DAY[m];
    const base = new Date(Date.UTC(2026, 0, 1) + (n - 1) * 86400000);
    for (const hour of [8, 10, 12, 14, 16]) {
      // UTC instant whose local apparent solar time is `hour`.
      const approx = new Date(base.getTime() + (hour - lon / 15) * 3600000);
      const eot = solarPosition(approx, lat, lon).equationOfTime;
      const t = new Date(base.getTime() + (hour - lon / 15 - eot / 60) * 3600000);
      const a = solarPosition(t, lat, lon), b = sunAt(dayOfYear(t), hour, lat);
      worst = Math.max(worst, Math.abs(a.elevation - b.elevation));
    }
  }
  assert.ok(worst < 0.6, `max elevation disagreement ${worst}°`);
});

test('NOAA position for a known instant', () => {
  // 2026-06-21 12:00 local solar time near Greenwich at 51.5N: elevation ≈ 90 - 51.5 + 23.44.
  const t = new Date(Date.UTC(2026, 5, 21, 12, 2));
  const p = solarPosition(t, 51.5, 0);
  near(p.elevation, 61.9, 0.2);
  near(p.azimuth, 180, 1);
});

test('air mass is 1 at zenith and grows towards the horizon', () => {
  near(airMass(0), 1, 0.001);
  near(airMass(60), 2, 0.01);
  assert.ok(airMass(89) > 20 && airMass(90) === Infinity);
});

test('clear sky irradiance is physically sensible', () => {
  const hi = clearSky(80), lo = clearSky(10);
  assert.ok(hi.ghi > 900 && hi.ghi < 1100);
  assert.ok(hi.dni > 850 && hi.dni < 1000);
  assert.ok(hi.dhi > 30 && hi.dhi < 150);
  assert.ok(lo.ghi < hi.ghi && lo.dni < hi.dni);
  assert.deepEqual(clearSky(-5), { ghi: 0, dni: 0, dhi: 0 });
  for (const e of [2, 15, 45, 75]) {
    const c = clearSky(e);
    near(c.dni * Math.sin((e * Math.PI) / 180) + c.dhi, c.ghi, 1e-6, 'closure');
  }
});

test('clouds cut global light and make it diffuse', () => {
  const clear = skyIrradiance(50, 172, 0), over = skyIrradiance(50, 172, 1);
  assert.ok(over.ghi < clear.ghi * 0.3);
  near(over.dhi, over.ghi, 1e-6);
  near(over.dni, 0, 1e-6);
});

test('sun vector points where the azimuth says', () => {
  const s = sunVector(180, 0);
  near(s.z, 1, 1e-9); near(s.x, 0, 1e-9);
  const e = sunVector(90, 30);
  assert.ok(e.x > 0.8 && e.y > 0.49 && Math.abs(e.z) < 1e-9);
  near(Math.hypot(e.x, e.y, e.z), 1, 1e-12);
});
