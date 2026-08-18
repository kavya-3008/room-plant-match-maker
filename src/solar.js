// Solar geometry and clear-sky irradiance. Pure functions, no DOM.
//
// Two independent sun-position paths are provided and cross-checked in tests:
//   - solarPosition(date, lat, lon): NOAA's spreadsheet algorithm (Meeus-based), for a real UTC instant.
//   - sunAt(dayOfYear, solarHour, lat): Spencer (1971) Fourier series for declination, in local solar time.
// The daylight simulation uses sunAt, because it reasons in solar time on representative days and does not
// need longitude or time zones.
//
// Angles: azimuth in degrees clockwise from true north (90 = east, 180 = south); elevation in degrees above
// the horizon.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const SOLAR_CONSTANT = 1361; // W/m², total solar irradiance at 1 AU (Kopp & Lean 2011)

/** Klein (1977) recommended average day for each month: the day whose declination is closest to the monthly mean. */
export const MONTH_REP_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (a, n) => ((a % n) + n) % n;

/** Day of year (1..366) for a Date, in UTC. */
export function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Spencer (1971) declination in degrees. Error vs. ephemeris is about 0.035°. */
export function declination(n) {
  const g = (2 * Math.PI * (n - 1)) / 365;
  const d = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return d * DEG;
}

/** Spencer (1971) equation of time in minutes (apparent minus mean solar time). */
export function equationOfTime(n) {
  const g = (2 * Math.PI * (n - 1)) / 365;
  return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
}

/** Extraterrestrial normal irradiance (W/m²) on day n, correcting for Earth-Sun distance. */
export function extraterrestrial(n) {
  return SOLAR_CONSTANT * (1 + 0.033 * Math.cos((2 * Math.PI * n) / 365));
}

/**
 * Sun position from day of year, local apparent solar time (hours, 12 = solar noon) and latitude (deg, north +).
 * @returns {{ elevation: number, azimuth: number, declination: number, hourAngle: number }}
 */
export function sunAt(n, solarHour, lat) {
  const dec = declination(n);
  const w = 15 * (solarHour - 12); // hour angle, negative in the morning
  const phi = lat * RAD, d = dec * RAD, h = w * RAD;
  const sinEl = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
  const elevation = Math.asin(clamp(sinEl, -1, 1)) * DEG;
  // Azimuth from north, clockwise. atan2 form avoids the quadrant ambiguity of the acos form.
  const azimuth = mod(Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * DEG + 180, 360);
  return { elevation, azimuth, declination: dec, hourAngle: w };
}

/**
 * Sunrise and sunset in local solar hours. Handles polar day / night.
 * @returns {{ sunrise: number, sunset: number, dayLength: number, polar: 'day'|'night'|null }}
 */
export function sunTimes(n, lat) {
  const x = -Math.tan(lat * RAD) * Math.tan(declination(n) * RAD);
  if (x <= -1) return { sunrise: 0, sunset: 24, dayLength: 24, polar: 'day' };
  if (x >= 1) return { sunrise: 12, sunset: 12, dayLength: 0, polar: 'night' };
  const ws = Math.acos(x) * DEG / 15; // half day length, hours
  return { sunrise: 12 - ws, sunset: 12 + ws, dayLength: 2 * ws, polar: null };
}

/** Julian day number (fractional) for a JS Date. */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * NOAA solar position for a real instant. Accuracy about 0.01° for years 1800-2100 (ignoring refraction).
 * @param {Date} date UTC instant
 * @param {number} lat degrees north
 * @param {number} lon degrees east
 */
export function solarPosition(date, lat, lon) {
  const jc = (julianDay(date) - 2451545) / 36525;
  const L0 = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360);
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const dec = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) * DEG;
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = mod(minutesUtc + eqTime + 4 * lon, 1440);
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const phi = lat * RAD, d = dec * RAD;
  const cosZ = clamp(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(ha * RAD), -1, 1);
  const zen = Math.acos(cosZ) * DEG;
  let azimuth;
  const denom = Math.cos(phi) * Math.sin(zen * RAD);
  if (Math.abs(denom) < 1e-9) azimuth = lat > 0 ? 180 : 0; // sun at zenith or observer at a pole
  else {
    const a = Math.acos(clamp((Math.sin(phi) * cosZ - Math.sin(d)) / denom, -1, 1)) * DEG;
    azimuth = ha > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }
  return { elevation: 90 - zen, azimuth, declination: dec, equationOfTime: eqTime, hourAngle: ha };
}

/** Kasten & Young (1989) relative optical air mass. Valid down to the horizon. */
export function airMass(zenithDeg) {
  if (zenithDeg >= 90) return Infinity;
  return 1 / (Math.cos(zenithDeg * RAD) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364);
}

/**
 * Clear-sky irradiance split into beam and diffuse.
 * GHI from Haurwitz (1945); DNI from Meinel & Meinel (1976) with the Kasten-Young air mass; DHI as the remainder.
 * These are simple, parameter-free models: fine for relative indoor comparisons, not for PV yield.
 * @returns {{ ghi: number, dni: number, dhi: number }} W/m²
 */
export function clearSky(elevationDeg, n = 172) {
  if (elevationDeg <= 0) return { ghi: 0, dni: 0, dhi: 0 };
  const z = 90 - elevationDeg;
  const cz = Math.cos(z * RAD);
  const ghi = 1098 * cz * Math.exp(-0.057 / cz);
  const am = airMass(z);
  const dni = extraterrestrial(n) * 0.7 ** (am ** 0.678);
  const beamH = Math.min(dni * cz, ghi * 0.92);
  return { ghi, dni: beamH / cz, dhi: ghi - beamH };
}

/**
 * Cloud-adjusted irradiance. Global reduction follows Kasten & Czeplak (1980): G = Gclear (1 - 0.75 C^3.4).
 * The diffuse fraction moves from the clear-sky split towards fully diffuse as C² (shape after the same paper).
 * @param {number} cloud cloud cover fraction 0..1
 */
export function skyIrradiance(elevationDeg, n, cloud = 0) {
  const c = clearSky(elevationDeg, n);
  if (c.ghi === 0) return c;
  const C = clamp(cloud, 0, 1);
  const ghi = c.ghi * (1 - 0.75 * C ** 3.4);
  const kdClear = c.dhi / c.ghi;
  const kd = kdClear + (1 - kdClear) * C * C;
  const dhi = ghi * kd;
  const cz = Math.sin(elevationDeg * RAD);
  return { ghi, dhi, dni: (ghi - dhi) / cz };
}

/** Unit vector pointing at the sun in world axes: +x east, +y up, +z south (the room's frame before rotation). */
export function sunVector(azimuthDeg, elevationDeg) {
  const a = azimuthDeg * RAD, e = elevationDeg * RAD;
  return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) };
}

/** A few reference latitudes for the UI. Latitude only: no climate data is implied. */
export const CITY_PRESETS = [
  { name: 'San Diego', lat: 32.7 },
  { name: 'Los Angeles', lat: 34.1 },
  { name: 'San Francisco', lat: 37.8 },
  { name: 'Seattle', lat: 47.6 },
  { name: 'Phoenix', lat: 33.4 },
  { name: 'New York', lat: 40.7 },
  { name: 'Chicago', lat: 41.9 },
  { name: 'London', lat: 51.5 },
  { name: 'Stockholm', lat: 59.3 },
  { name: 'Mumbai', lat: 19.1 },
  { name: 'Singapore', lat: 1.35 },
  { name: 'Sydney', lat: -33.9 },
];
