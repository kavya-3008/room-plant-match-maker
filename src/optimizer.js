// Plant placement as an optimisation problem, solved with simulated annealing.
//
// State: a set of (plant, cell) pairs, each plant and each cell used at most once.
// Objective (higher is better), all terms documented in scoreLayout():
//   + light fit of each plant to its cell's annual-mean DLI (log-scale, peaked inside the plant's range)
//   × a winter factor if the darkest month falls below the plant's minimum
//   - overlap between neighbours' mature spreads
//   - tall plants parked in front of a window (they shade everything behind them)
//   + a small bonus for grouping humidity lovers (they raise each other's local humidity)
//   + a small bonus for visual variety (different growth forms)
// A badly fitting plant scores below zero, so the search prefers an empty slot to a plant in the wrong light.
//
// Moves: relocate, swap two plants' cells, replace a plant with an unused one, add, remove.
// Temperature falls geometrically; the best state seen is returned. Seeded, so runs are reproducible.

import { CELL_M, plantableCells, key } from './floorplan.js';
import { dliClass } from './daylight.js';
import { mulberry32, pick } from './random.js';

export const DEFAULT_WEIGHTS = {
  empty: 0.2,      // a placed plant must fit better than this to be worth its slot
  overlap: 2.0,
  windowBlock: 0.35,
  humidityPair: 0.08,
  variety: 0.05,
  winter: 0.4,     // max share of a plant's fit lost to a too-dark winter
};

/**
 * Light fit in 0..1 for a plant at a given DLI. 1 at the geometric centre of the plant's range,
 * 0.75 at its edges, then a Gaussian fall-off in log units outside it.
 */
export function lightFit(plant, dli) {
  const v = Math.log(Math.max(dli, 0.05));
  const lo = Math.log(plant.dli[0]), hi = Math.log(plant.dli[1]);
  const mid = (lo + hi) / 2, half = (hi - lo) / 2;
  if (v >= lo && v <= hi) return 1 - 0.25 * ((v - mid) / half) ** 2;
  const dist = v < lo ? lo - v : v - hi;
  return 0.75 * Math.exp(-((dist / 0.35) ** 2));
}

/** Multiplier in [1 - winterWeight, 1] for a plant whose darkest month dips below its minimum. */
export function winterFactor(plant, dliMin, weight = DEFAULT_WEIGHTS.winter) {
  if (dliMin >= plant.dli[0]) return 1;
  const short = Math.log(plant.dli[0] / Math.max(dliMin, 0.05));
  return 1 - weight * (1 - Math.exp(-((short / 0.6) ** 2)));
}

/** Cells directly in front of a window opening (one or two cells deep). */
export function windowFrontCells(room, depth = 2) {
  const s = new Set();
  for (const w of room.windows) for (let a = w.pos; a < w.pos + w.width; a++) for (let k = 0; k < depth; k++) {
    if (w.wall === 'N') s.add(key(a, k)); else if (w.wall === 'S') s.add(key(a, room.d - 1 - k));
    else if (w.wall === 'W') s.add(key(k, a)); else s.add(key(room.w - 1 - k, a));
  }
  return s;
}

/**
 * Build the search problem once: candidate cells with their light, and the plant pool.
 * @param {object} room normalized room
 * @param {{ mean: number[][], min: number[][] }} light annual DLI grids from simulateYear
 * @param {object[]} pool plants allowed by the user's preferences
 */
export function buildProblem(room, light, pool, { weights = DEFAULT_WEIGHTS } = {}) {
  const cells = plantableCells(room).map((c) => ({ ...c, dli: light.mean[c.x][c.z], dliMin: light.min[c.x][c.z] }));
  const front = windowFrontCells(room);
  cells.forEach((c) => { c.front = front.has(key(c.x, c.z)); });
  // fit[p][c] is reused by every score evaluation
  const fit = pool.map((p) => cells.map((c) => lightFit(p, c.dli) * winterFactor(p, c.dliMin, weights.winter)));
  return { room, cells, pool, fit, weights: { ...DEFAULT_WEIGHTS, ...weights } };
}

/**
 * Score a layout. layout: array of { p: poolIndex, c: cellIndex }.
 * @returns {{ total: number, terms: Record<string, number> }}
 */
export function scoreLayout(prob, layout) {
  const { cells, pool, fit, weights: W } = prob;
  const terms = { fit: 0, overlap: 0, windowBlock: 0, humidity: 0, variety: 0 };
  for (const { p, c } of layout) {
    terms.fit += fit[p][c] - W.empty;
    if (cells[c].front && pool[p].height > 1.0) terms.windowBlock -= W.windowBlock;
  }
  for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
    const a = layout[i], b = layout[j];
    const pa = pool[a.p], pb = pool[b.p], ca = cells[a.c], cb = cells[b.c];
    const dist = Math.hypot(ca.x - cb.x, ca.z - cb.z) * CELL_M;
    const need = ((pa.spread + pb.spread) / 2) * 0.8;
    if (dist < need) terms.overlap -= (W.overlap * (need - dist)) / need;
    if (pa.rhMin >= 50 && pb.rhMin >= 50 && dist <= 1.5) terms.humidity += W.humidityPair;
  }
  terms.variety = W.variety * new Set(layout.map(({ p }) => pool[p].model.kind)).size;
  const total = Object.values(terms).reduce((s, v) => s + v, 0);
  return { total, terms };
}

/** Greedy start: repeatedly take the best (plant, free cell) pair whose marginal score is positive. */
export function greedyLayout(prob, maxPlants) {
  const layout = [];
  const usedP = new Set(), usedC = new Set();
  let current = scoreLayout(prob, layout).total;
  while (layout.length < maxPlants) {
    let best = null;
    for (let p = 0; p < prob.pool.length; p++) {
      if (usedP.has(p)) continue;
      // only consider this plant's top few cells to keep greedy cheap
      const order = prob.cells.map((_, c) => c).filter((c) => !usedC.has(c)).sort((a, b) => prob.fit[p][b] - prob.fit[p][a]).slice(0, 6);
      for (const c of order) {
        const s = scoreLayout(prob, [...layout, { p, c }]).total;
        if (s > current + 1e-9 && (!best || s > best.s)) best = { p, c, s };
      }
    }
    if (!best) break;
    layout.push({ p: best.p, c: best.c });
    usedP.add(best.p); usedC.add(best.c);
    current = best.s;
  }
  return layout;
}

/**
 * Simulated annealing from the greedy layout.
 * @returns {{ layout, score, initial, accepted, iterations }}
 */
export function anneal(prob, { maxPlants = 6, iterations = 5000, seed = 1, t0 = 0.4, t1 = 0.002 } = {}) {
  const rng = mulberry32(seed);
  const nP = prob.pool.length, nC = prob.cells.length;
  let cur = greedyLayout(prob, maxPlants);
  let curS = scoreLayout(prob, cur).total;
  const initial = curS;
  let best = cur.slice(), bestS = curS, accepted = 0;
  if (!nP || !nC) return { layout: cur, score: curS, initial, accepted, iterations: 0 };

  const freeCell = (layout) => {
    const used = new Set(layout.map((e) => e.c));
    for (let tries = 0; tries < 20; tries++) { const c = Math.floor(rng() * nC); if (!used.has(c)) return c; }
    return -1;
  };
  const freePlant = (layout) => {
    const used = new Set(layout.map((e) => e.p));
    const free = [];
    for (let p = 0; p < nP; p++) if (!used.has(p)) free.push(p);
    return free.length ? pick(rng, free) : -1;
  };

  for (let it = 0; it < iterations; it++) {
    const T = t0 * (t1 / t0) ** (it / iterations);
    const next = cur.map((e) => ({ ...e }));
    const r = rng();
    if (r < 0.4 && next.length) {
      const c = freeCell(next); if (c < 0) continue;
      next[Math.floor(rng() * next.length)].c = c;
    } else if (r < 0.6 && next.length > 1) {
      const i = Math.floor(rng() * next.length); let j = Math.floor(rng() * (next.length - 1)); if (j >= i) j++;
      [next[i].c, next[j].c] = [next[j].c, next[i].c];
    } else if (r < 0.85 && next.length) {
      const p = freePlant(next); if (p < 0) continue;
      next[Math.floor(rng() * next.length)].p = p;
    } else if (r < 0.95 && next.length < maxPlants) {
      const p = freePlant(next), c = freeCell(next); if (p < 0 || c < 0) continue;
      next.push({ p, c });
    } else if (next.length) {
      next.splice(Math.floor(rng() * next.length), 1);
    } else continue;
    const s = scoreLayout(prob, next).total;
    if (s >= curS || rng() < Math.exp((s - curS) / T)) {
      cur = next; curS = s; accepted++;
      if (s > bestS + 1e-12) { best = next; bestS = s; }
    }
  }
  return { layout: best, score: bestS, initial, accepted, iterations };
}

/** Turn a layout into the placement records the UI and care model use, with a short reason for each. */
export function toPlacements(prob, layout) {
  return layout.map(({ p, c }) => {
    const plant = prob.pool[p], cell = prob.cells[c];
    const reasons = [`${cell.dli.toFixed(1)} mol/m²/day here on average (it wants ${plant.dli[0]}-${plant.dli[1]})`];
    if (cell.dliMin < plant.dli[0]) reasons.push(`darkest month drops to ${cell.dliMin.toFixed(1)}: expect slower growth in winter`);
    if (plant.rhMin >= 50 && layout.some((o) => o !== undefined && o.c !== c && prob.pool[o.p].rhMin >= 50
      && Math.hypot(prob.cells[o.c].x - cell.x, prob.cells[o.c].z - cell.z) * CELL_M <= 1.5)) reasons.push('grouped with other humidity lovers');
    return {
      plant, x: cell.x, z: cell.z, dli: cell.dli, dliMin: cell.dliMin,
      light: cell.dli, lightClass: dliClass(cell.dli), fit: prob.fit[p][c], reasons,
    };
  }).sort((a, b) => b.fit - a.fit);
}

/** Convenience wrapper: preferences → pool → optimised placements. */
export function optimizePlacements(room, light, plants, prefs = {}, opts = {}) {
  const { pets = false, experience = 3, maxPlants = 6, edibleOnly = false } = prefs;
  const pool = plants.filter((p) => (!pets || p.petSafe) && p.difficulty <= experience && (!edibleOnly || p.edible));
  const prob = buildProblem(room, light, pool, opts);
  const res = anneal(prob, { maxPlants, ...opts });
  return { placements: toPlacements(prob, res.layout), ...res, problem: prob };
}
