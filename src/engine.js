// Room light model, plant matching, lighting plan and care calendar. Pure functions, no DOM.
import { PLANTS } from './plants.js';

export const CELL_M = 0.5; // one grid cell = 0.5 m
export const LIGHT_CLASSES = ['low', 'medium', 'bright', 'direct'];
// How much daylight a window of each facing admits (northern hemisphere).
export const FACING = { N: 0.35, E: 0.7, S: 1.0, W: 0.8 };
const THRESHOLDS = [0.2, 0.45, 0.7];

export function windowCenter(room, w) {
  const mid = w.pos + w.width / 2;
  if (w.wall === 'N') return { cx: mid, cz: 0 };
  if (w.wall === 'S') return { cx: mid, cz: room.d };
  if (w.wall === 'W') return { cx: 0, cz: mid };
  return { cx: room.w, cz: mid };
}

/** Light value 0..1 at the centre of floor cell (x, z). `ambient` scales overall brightness. */
export function lightAt(room, x, z, ambient = 1) {
  let sum = 0;
  for (const w of room.windows) {
    const { cx, cz } = windowCenter(room, w);
    const dist = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) * CELL_M;
    sum += (FACING[w.wall] * w.width * CELL_M) / (1 + (dist / 1.5) ** 2);
  }
  return 1 - Math.exp(-0.8 * sum * ambient);
}

export function classOf(v) {
  return THRESHOLDS.filter((t) => v >= t).length;
}

export function lightGrid(room, ambient = 1) {
  const grid = [];
  for (let x = 0; x < room.w; x++) {
    grid.push([]);
    for (let z = 0; z < room.d; z++) grid[x].push(lightAt(room, x, z, ambient));
  }
  return grid;
}

export function lightSummary(grid) {
  const counts = [0, 0, 0, 0];
  let total = 0;
  for (const col of grid) for (const v of col) { counts[classOf(v)]++; total++; }
  return { counts, fractions: counts.map((c) => (total ? c / total : 0)), total };
}

// Light value range covered by each class, used to find a plant's ideal light.
const CLASS_RANGE = [[0, 0.2], [0.2, 0.45], [0.45, 0.7], [0.7, 1]];
const idealLight = (p) => (CLASS_RANGE[p.light[0]][0] + CLASS_RANGE[p.light[1]][1]) / 2;
const fits = (p, v) => { const c = classOf(v); return c >= p.light[0] && c <= p.light[1]; };

/** Pick plants and cells. prefs: { pets, experience (1-3), maxPlants }. */
export function recommend(room, prefs = {}, ambient = 1) {
  const { pets = false, experience = 3, maxPlants = 6 } = prefs;
  const grid = lightGrid(room, ambient);
  const cells = [];
  for (let x = 0; x < room.w; x++)
    for (let z = 0; z < room.d; z++)
      if (Math.min(x, z, room.w - 1 - x, room.d - 1 - z) <= 1) cells.push({ x, z, v: grid[x][z] });

  const pool = PLANTS.filter((p) => (!pets || p.petSafe) && p.difficulty <= experience);
  // Place the pickiest plants (fewest fitting cells) first.
  const ranked = pool
    .map((p) => ({ p, n: cells.filter((c) => fits(p, c.v)).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => a.n - b.n || a.p.difficulty - b.p.difficulty);

  const placements = [];
  const taken = (c) => placements.some((q) => Math.max(Math.abs(q.x - c.x), Math.abs(q.z - c.z)) < 2);
  const used = {};
  // Round-robin over light classes so the room gets variety instead of ten sun-lovers.
  const byClass = [0, 1, 2, 3].map((k) => ranked.filter((r) => idealLight(r.p) >= CLASS_RANGE[k][0] && idealLight(r.p) < CLASS_RANGE[k][1] + (k === 3 ? 1 : 0)));
  let progressed = true;
  while (placements.length < maxPlants && progressed) {
    progressed = false;
    for (const group of byClass) {
      if (placements.length >= maxPlants) break;
      for (const { p } of group) {
        if ((used[p.id] || 0) >= 1) continue;
        const spots = cells.filter((c) => fits(p, c.v) && !taken(c));
        if (!spots.length) continue;
        spots.sort((a, b) => Math.abs(a.v - idealLight(p)) - Math.abs(b.v - idealLight(p)));
        const c = spots[0];
        placements.push({ plant: p, x: c.x, z: c.z, light: c.v, lightClass: classOf(c.v) });
        used[p.id] = 1;
        progressed = true;
        break;
      }
    }
  }
  return placements;
}

/** Grow-light suggestions for dark areas. Wattage is a rough rule of thumb, not a measurement. */
export function lightingPlan(room, ambient = 1) {
  const grid = lightGrid(room, ambient);
  const dark = [];
  for (let x = 0; x < room.w; x++) for (let z = 0; z < room.d; z++) if (classOf(grid[x][z]) === 0) dark.push({ x, z });
  const advice = [];
  const frac = dark.length / (room.w * room.d);
  const lamps = [];
  if (frac > 0.3) {
    // A lamp over the middle of the nearest-to-wall dark cells (so it can stand next to plants).
    const edge = dark.filter((c) => Math.min(c.x, c.z, room.w - 1 - c.x, room.d - 1 - c.z) <= 1);
    const src = edge.length ? edge : dark;
    const cx = Math.round(src.reduce((s, c) => s + c.x, 0) / src.length);
    const cz = Math.round(src.reduce((s, c) => s + c.z, 0) / src.length);
    const nearest = src.reduce((b, c) => (Math.hypot(c.x - cx, c.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? c : b));
    const areaM2 = Math.min(dark.length * CELL_M * CELL_M, 4);
    const watts = Math.max(15, Math.round((areaM2 * 30) / 5) * 5);
    lamps.push({ x: nearest.x, z: nearest.z, watts });
    advice.push(`${Math.round(frac * 100)}% of the floor is low light. A full-spectrum LED grow lamp (about ${watts} W) near the dark zone on a 10-12 h timer lets shade plants thrive there.`);
  }
  if (room.windows.every((w) => w.wall === 'N')) advice.push('Only north-facing windows: expect dim light. Choose low-light plants or add a lamp.');
  const hot = room.windows.filter((w) => w.wall === 'S' || w.wall === 'W');
  if (hot.length && hot.reduce((s, w) => s + w.width, 0) >= 6) advice.push('Large south/west windows: a sheer curtain in midsummer will stop leaf scorch on non-succulents.');
  if (!advice.length) advice.push('Natural light is well distributed; no extra lighting needed.');
  return { advice, lamps, darkFraction: frac };
}

/** Which plants need watering on each of the next `days` days. Stagger start days so chores spread out. */
export function careCalendar(placements, days = 28) {
  const cal = Array.from({ length: days }, () => []);
  placements.forEach((pl, i) => {
    const every = pl.plant.water;
    for (let d = (i % every) + 1; d <= days; d += every) cal[d - 1].push(pl.plant.name);
  });
  return cal;
}

/** Map an average photo brightness (0-1) to a light multiplier. Rough: a photo cannot see window geometry. */
export function ambientFromBrightness(b) {
  return Math.min(1.5, Math.max(0.5, 0.5 + b));
}
