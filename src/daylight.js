// Daylight simulation on the floor grid, reported as photosynthetic light: PPFD (µmol/m²/s) and
// daily light integral, DLI (mol/m²/day), the number horticulturists use to rate how much light a plant gets.
//
// Light reaching a receptor point (a plant's canopy, `height` metres above the floor) has three parts:
//   1. Direct beam: for each time step, cast a ray from the point towards the sun. It counts if it leaves
//      through a window opening, clears any overhang and exterior obstruction and is not blocked by furniture.
//      Glass transmittance falls off with incidence angle (ASHRAE incidence angle modifier, b0 = 0.1).
//   2. Sky diffuse: an isotropic sky seen through each window. The window rectangle is sampled; each sample
//      contributes L·τ(θ)·cosθr·cosθw·dA / r², with L = DHI/π. This is a numerical configuration factor and
//      depends only on geometry, so it is computed once per cell and reused for every hour and month.
//      Rays that hit an exterior obstruction see it at OBSTRUCTION_LUMINANCE of the sky's brightness.
//   3. Internally reflected: the BRE split-flux formula (Hopkinson, Longmore & Petherbridge) gives a uniform
//      interior reflected component from window area, room surface area and reflectances.
//
// Simplifications, on purpose: no circumsolar brightening, no interreflection pattern (IRC is uniform),
// no furniture reflection, and exterior obstruction is a uniform horizon angle in front of each window.

import { CELL_M, WALL_H_M, normalizeRoom, windowRect, furnitureBoxes, GLAZING } from './floorplan.js';
import { sunAt, sunTimes, skyIrradiance, sunVector, MONTH_REP_DAY } from './solar.js';

/** µmol/m²/s of PAR per W/m² of broadband sunlight. ~0.45-0.5 PAR fraction × ~4.57 µmol/J. ±10%. */
export const PAR_PER_WATT = 2.0;
/** DLI boundaries (mol/m²/day) between low | medium | bright | direct light. */
export const DLI_THRESHOLDS = [2, 5, 10];
export const OBSTRUCTION_LUMINANCE = 0.2;
const IAM_B0 = 0.1;
const SAMPLE_M = 0.1;  // diffuse sampling pitch on the window, metres
const MAX_SAMPLES = 24; // per window axis
const RAD = Math.PI / 180;

export const DEFAULT_SURFACES = { floor: 0.3, walls: 0.6, ceiling: 0.8 };

/** ASHRAE incidence angle modifier for glazing, as a function of cos(incidence). */
export function iam(cosTheta) {
  if (cosTheta <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - IAM_B0 * (1 / cosTheta - 1)));
}

export function dliClass(dli) {
  return DLI_THRESHOLDS.filter((t) => dli >= t).length;
}

/** Map DLI to 0..1 so the old 0.2 / 0.45 / 0.7 class thresholds line up with 2 / 5 / 10 mol. Monotonic. */
export function dliToUnit(dli) {
  const knots = [[0, 0], [2, 0.2], [5, 0.45], [10, 0.7], [30, 1]];
  if (dli >= 30) return 1;
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (dli <= x1) { const [x0, y0] = knots[i - 1]; return y0 + ((dli - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return 1;
}

/** Slab test: does the segment p→q pass through the axis-aligned box b? */
export function segmentHitsBox(p, q, b) {
  let t0 = 1e-6, t1 = 1 - 1e-6;
  for (const [a, lo, hi] of [['x', b.x0, b.x1], ['y', b.y0, b.y1], ['z', b.z0, b.z1]]) {
    const d = q[a] - p[a];
    if (Math.abs(d) < 1e-12) { if (p[a] < lo || p[a] > hi) return false; continue; }
    let ta = (lo - p[a]) / d, tb = (hi - p[a]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** Where does a ray from P with unit direction s cross the window opening? null if it does not. */
export function throughWindow(P, s, rect) {
  const sn = s.x * rect.n.x + s.z * rect.n.z;
  if (sn <= 1e-9) return null;
  const t = (rect.plane - P[rect.axis]) / s[rect.axis];
  if (!(t > 0)) return null;
  const a = P[rect.alongAxis] + t * s[rect.alongAxis];
  const y = P.y + t * s.y;
  if (a < rect.a0 || a > rect.a1 || y < rect.y0 || y > rect.y1) return null;
  const hit = { x: P.x + t * s.x, y, z: P.z + t * s.z };
  return { t, hit, cos: sn };
}

/** Does a ray leaving the window at height y, direction s, run into a horizontal overhang of depth `depth`? */
function hitsOverhang(y, s, sn, head, depth) {
  if (!depth || s.y <= 0) return false;
  return y + (depth / sn) * s.y > head;
}

function blockedByFurniture(P, Q, boxes) {
  for (const b of boxes) if (segmentHitsBox(P, Q, b)) return true;
  return false;
}

/** BRE obstruction coefficient C as a function of obstruction angle, interpolated from the published table. */
export function breC(obstructionDeg) {
  const table = [[0, 39], [10, 35], [20, 31], [30, 25], [40, 20], [50, 14], [60, 10], [70, 7], [80, 5]];
  const t = Math.max(0, Math.min(80, obstructionDeg));
  for (let i = 1; i < table.length; i++) if (t <= table[i][0]) {
    const [a0, c0] = table[i - 1], [a1, c1] = table[i];
    return c0 + ((t - a0) / (a1 - a0)) * (c1 - c0);
  }
  return 5;
}

/**
 * Interior reflected component as a daylight factor (%) by the BRE split-flux formula:
 *   DF_irc = τ W (C·Rfw + 5·Rcw) / (A (1 - R))
 * The classic formula's 0.85 is clean single glazing's transmittance; we use each window's own τ.
 */
export function splitFluxIRC(room, surfaces = DEFAULT_SURFACES) {
  const W = room.w * CELL_M, D = room.d * CELL_M, H = WALL_H_M;
  const floorA = W * D, perim = 2 * (W + D), wallA = perim * H;
  const wins = room.windows;
  const winA = wins.reduce((s, w) => s + w.width * CELL_M * (w.head - w.sill), 0);
  if (!winA) return 0;
  const A = 2 * floorA + wallA;
  const R = (surfaces.floor * floorA + surfaces.ceiling * floorA + surfaces.walls * (wallA - winA) + 0.15 * winA) / A;
  const mid = wins.reduce((s, w) => s + ((w.sill + w.head) / 2) * w.width, 0) / wins.reduce((s, w) => s + w.width, 0);
  const Rfw = (surfaces.floor * floorA + surfaces.walls * perim * mid) / (floorA + perim * mid);
  const Rcw = (surfaces.ceiling * floorA + surfaces.walls * perim * (H - mid)) / (floorA + perim * (H - mid));
  let df = 0;
  for (const w of wins) {
    const a = w.width * CELL_M * (w.head - w.sill);
    const tau = GLAZING[w.glazing].tau * (1 - (w.curtain || 0));
    df += (tau * a * (breC(w.obstruction) * Rfw + 5 * Rcw)) / (A * (1 - R));
  }
  return df; // percent
}

/**
 * Precompute everything that depends only on geometry.
 * @param {object} room  { w, d, rotation?, windows[], doors?, furniture? }
 * @param {{ height?: number, surfaces?: object }} opts
 */
export function prepare(room, { height = 0.4, surfaces = DEFAULT_SURFACES } = {}) {
  const r = normalizeRoom(room);
  const boxes = furnitureBoxes(r);
  const wins = r.windows.map((w) => {
    const rect = windowRect(r, w);
    return { w, rect, tau: GLAZING[w.glazing].tau * (1 - (w.curtain || 0)) };
  });
  const sky = []; // sky[x][z] = configuration factor through all windows (dimensionless, includes τ and 1/π)
  for (let x = 0; x < r.w; x++) {
    sky.push([]);
    for (let z = 0; z < r.d; z++) {
      const P = { x: (x + 0.5) * CELL_M, y: height, z: (z + 0.5) * CELL_M };
      let F = 0;
      for (const { w, rect, tau } of wins) F += skyFactor(P, rect, w, tau, boxes);
      sky[x].push(F);
    }
  }
  return { room: r, boxes, wins, sky, irc: splitFluxIRC(r, surfaces) / 100, height };
}

function skyFactor(P, rect, w, tau, boxes) {
  const len = rect.a1 - rect.a0, hgt = rect.y1 - rect.y0;
  const nu = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(len / SAMPLE_M)));
  const nv = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(hgt / SAMPLE_M)));
  const dA = (len * hgt) / (nu * nv);
  let F = 0;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = rect.a0 + ((i + 0.5) / nu) * len, y = rect.y0 + ((j + 0.5) / nv) * hgt;
    const Q = rect.axis === 'z' ? { x: a, y, z: rect.plane } : { x: rect.plane, y, z: a };
    const rx = Q.x - P.x, ry = Q.y - P.y, rz = Q.z - P.z;
    if (ry <= 0) continue; // a horizontal, upward-facing receptor cannot see below its own plane
    const r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
    const cosR = ry / r, cosW = (rx * rect.n.x + rz * rect.n.z) / r;
    if (cosW <= 0) continue;
    const u = { x: rx / r, y: ry / r, z: rz / r };
    if (hitsOverhang(y, u, cosW, rect.y1, w.overhang)) continue;
    if (blockedByFurniture(P, Q, boxes)) continue;
    const elev = Math.asin(u.y) / RAD;
    const lum = elev < w.obstruction ? OBSTRUCTION_LUMINANCE : 1;
    F += (tau * iam(cosW) * cosR * cosW * dA * lum) / (Math.PI * r2);
  }
  return F;
}

/** Sun direction in the room's own frame (accounts for room rotation). */
export function roomSun(prep, n, hour, lat) {
  const sp = sunAt(n, hour, lat);
  return { ...sp, vec: sunVector(sp.azimuth - prep.room.rotation, sp.elevation) };
}

/** Direct-beam transmission factor (τ·IAM) for a cell at one sun direction; 0 if shaded. */
export function directFactor(prep, x, z, s, elevation) {
  const P = { x: (x + 0.5) * CELL_M, y: prep.height, z: (z + 0.5) * CELL_M };
  let f = 0;
  for (const { w, rect, tau } of prep.wins) {
    if (elevation < w.obstruction) continue;
    const h = throughWindow(P, s, rect);
    if (!h) continue;
    if (hitsOverhang(h.hit.y, s, h.cos, rect.y1, w.overhang)) continue;
    if (blockedByFurniture(P, h.hit, prep.boxes)) continue;
    f += tau * iam(h.cos);
  }
  return f;
}

/** PPFD grid (µmol/m²/s) at one instant. Also returns which cells are in direct sun. */
export function instant(prep, { n, hour, lat, cloud = 0 }) {
  const sun = roomSun(prep, n, hour, lat);
  const { w, d } = prep.room;
  const ppfd = [], sunlit = [];
  if (sun.elevation <= 0) {
    for (let x = 0; x < w; x++) { ppfd.push(new Array(d).fill(0)); sunlit.push(new Array(d).fill(false)); }
    return { ppfd, sunlit, sun };
  }
  const irr = skyIrradiance(sun.elevation, n, cloud);
  for (let x = 0; x < w; x++) {
    ppfd.push([]); sunlit.push([]);
    for (let z = 0; z < d; z++) {
      const df = irr.dni > 0 ? directFactor(prep, x, z, sun.vec, sun.elevation) : 0;
      const e = irr.dni * sun.vec.y * df + irr.dhi * prep.sky[x][z] + irr.ghi * prep.irc;
      ppfd[x].push(e * PAR_PER_WATT);
      sunlit[x].push(df > 0);
    }
  }
  return { ppfd, sunlit, sun, irradiance: irr };
}

/**
 * Integrate one day. Midpoint rule between sunrise and sunset in `stepMin` minute steps.
 * @returns {{ dli: number[][], sunHours: number[][], peak: number[][], dayLength: number }}
 */
export function simulateDay(prep, { n, lat, cloud = 0, stepMin = 15 }) {
  const { w, d } = prep.room;
  const zeros = () => Array.from({ length: w }, () => new Array(d).fill(0));
  const dli = zeros(), sunHours = zeros(), peak = zeros();
  const { sunrise, dayLength } = sunTimes(n, lat);
  if (dayLength <= 0) return { dli, sunHours, peak, dayLength };
  const steps = Math.max(4, Math.ceil((dayLength * 60) / stepMin));
  const dt = dayLength / steps; // hours
  for (let k = 0; k < steps; k++) {
    const hour = sunrise + (k + 0.5) * dt;
    const { ppfd, sunlit } = instant(prep, { n, hour, lat, cloud });
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
      dli[x][z] += (ppfd[x][z] * dt * 3600) / 1e6;
      if (sunlit[x][z]) sunHours[x][z] += dt;
      if (ppfd[x][z] > peak[x][z]) peak[x][z] = ppfd[x][z];
    }
  }
  return { dli, sunHours, peak, dayLength };
}

/**
 * Twelve representative days (Klein 1977). `cloud` may be a number or a 12-element array.
 * @returns {{ months: Array, min: number[][], max: number[][], mean: number[][] }}
 */
export function simulateYear(prep, { lat, cloud = 0.4, stepMin = 20 }) {
  const months = MONTH_REP_DAY.map((n, m) => simulateDay(prep, { n, lat, cloud: Array.isArray(cloud) ? cloud[m] : cloud, stepMin }));
  const { w, d } = prep.room;
  const agg = (f) => Array.from({ length: w }, (_, x) => Array.from({ length: d }, (_, z) => f(months.map((mo) => mo.dli[x][z]))));
  return {
    months,
    min: agg((v) => Math.min(...v)),
    max: agg((v) => Math.max(...v)),
    mean: agg((v) => v.reduce((a, b) => a + b, 0) / v.length),
  };
}

/** Floor-average DLI and class fractions for a grid. */
export function summarize(grid) {
  const counts = [0, 0, 0, 0];
  let sum = 0, total = 0;
  for (const col of grid) for (const v of col) { counts[dliClass(v)]++; sum += v; total++; }
  return { mean: total ? sum / total : 0, counts, fractions: counts.map((c) => (total ? c / total : 0)), total };
}
