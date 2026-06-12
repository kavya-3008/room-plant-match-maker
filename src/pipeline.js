// One call from app state to everything the UI shows: light simulation, placements, lamps, advice and care.
// Pure (no DOM), so the whole flow is testable in Node.

import { normalizeRoom, validateRoom } from './floorplan.js';
import { prepare, simulateYear, summarize, dliToUnit, instant, roomSun } from './daylight.js';
import { optimizePlacements } from './optimizer.js';
import { planLamps, lightingAdvice, lampDLI } from './growlight.js';
import { buildSchedule, indoorClimate, simulatePot } from './care.js';
import { MONTH_REP_DAY, sunTimes } from './solar.js';
import { PLANTS } from './plants.js';
import { CELL_M } from './floorplan.js';

export const DEFAULT_STATE = Object.freeze({
  w: 10, d: 8, rotation: 0,
  windows: [{ wall: 'S', pos: 2, width: 4 }, { wall: 'E', pos: 2, width: 2 }],
  doors: [], furniture: [],
  lat: 32.7, month: new Date().getMonth(), cloud: 0.4,
  pets: false, exp: 3, n: 6, edibleOnly: false,
  ambient: 1, choreDays: [], seed: 1,
});

/** Room part of the app state. */
export const roomOf = (s) => ({ w: s.w, d: s.d, rotation: s.rotation, windows: s.windows, doors: s.doors, furniture: s.furniture });

const scaleGrid = (g, k) => g.map((col) => col.map((v) => v * k));

/**
 * @param {object} state app state (see DEFAULT_STATE)
 * @param {{ iterations?: number, start?: Date, days?: number }} opts
 */
export function analyze(state, { iterations = 4000, start, days = 28 } = {}) {
  const s = { ...DEFAULT_STATE, ...state };
  const room = normalizeRoom(roomOf(s));
  const errors = validateRoom(room);
  const prep = prepare(room);
  const raw = simulateYear(prep, { lat: s.lat, cloud: s.cloud });
  // Optional photo calibration: a single multiplier on every grid (rough; documented in the UI).
  const k = s.ambient ?? 1;
  const year = k === 1 ? raw : {
    months: raw.months.map((m) => ({ ...m, dli: scaleGrid(m.dli, k) })),
    min: scaleGrid(raw.min, k), max: scaleGrid(raw.max, k), mean: scaleGrid(raw.mean, k),
  };

  const opt = optimizePlacements(room, year, PLANTS, { pets: s.pets, experience: s.exp, maxPlants: s.n, edibleOnly: s.edibleOnly }, { seed: s.seed, iterations });
  const climate = indoorClimate(s.lat);
  const placements = opt.placements.map((pl) => {
    const monthlyDli = year.months.map((m) => m.dli[pl.x][pl.z]);
    const care = simulatePot({ plant: pl.plant, monthlyDli }, { start: start || new Date(Date.UTC(2026, s.month, 1)), days: 120, lat: s.lat, climate });
    return { ...pl, monthlyDli, interval: care.averageInterval, pot: care.pot };
  });
  const plan = planLamps(room, placements);
  const advice = lightingAdvice(room, year, placements, plan);
  const schedule = buildSchedule(placements, { start, days, lat: s.lat, climate, choreDays: s.choreDays });

  const monthGrid = year.months[s.month].dli;
  // What the floor gets in the selected month with the lamps that run that month.
  const running = plan.lamps.filter((l) => l.months.includes(s.month));
  const withLamps = monthGrid.map((col, x) => col.map((v, z) => v + running.reduce((a, l) => a + lampDLI(l.watts, Math.hypot(l.x - x, l.z - z) * CELL_M, l), 0)));
  return {
    state: s, room, errors, prep, year, placements, plan, advice, schedule, climate,
    monthGrid, withLamps,
    unitGrid: withLamps.map((col) => col.map(dliToUnit)),
    summary: summarize(monthGrid),
    roomMeanByMonth: year.months.map((m) => summarize(m.dli).mean),
    search: { score: opt.score, initial: opt.initial, accepted: opt.accepted, iterations: opt.iterations, pool: opt.problem.pool.length, cells: opt.problem.cells.length },
  };
}

/** Light and sun at a fraction t (0..1) of the selected month's daylight hours, for the time slider. */
export function atTime(result, t) {
  const { state: s, prep } = result;
  const n = MONTH_REP_DAY[s.month];
  const { sunrise, sunset } = sunTimes(n, s.lat);
  const hour = sunrise + t * (sunset - sunrise);
  const snap = instant(prep, { n, hour, lat: s.lat, cloud: s.cloud });
  return { hour, sun: roomSun(prep, n, hour, s.lat), ...snap };
}
