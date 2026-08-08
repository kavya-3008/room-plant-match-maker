// Grow-lamp planning: size and place LED lamps so every plant reaches its minimum DLI in its darkest month.
//
// Lamp photometry: an LED panel emits PPF = watts × efficacy (µmol/s). Treating it as a Lambertian emitter
// facing down, its PPFD on the canopy plane at horizontal distance r and height h is
//     E(r) = PPF · h² / (π (h² + r²)²)
// which integrates to exactly PPF over the infinite plane. Real lamps with lenses are more focused, so this
// is conservative (it underestimates light directly below the lamp).
//
// Placement: greedy set cover. Each candidate (cell, wattage) is scored by the plant light deficit it removes per
// watt; the best is taken until every deficit is covered or the lamp budget runs out, then each lamp is
// downsized to the smallest wattage that still does its job.

import { CELL_M } from './floorplan.js';

export const LAMP_DEFAULTS = { efficacy: 2.3, mountHeight: 0.5, hours: 12, wattOptions: [15, 25, 40, 65], maxLamps: 3, price: 0.3, margin: 1.1 };

/** PPFD (µmol/m²/s) on the canopy at horizontal distance r (m) from a lamp. */
export function lampPPFD(watts, r, { efficacy = LAMP_DEFAULTS.efficacy, mountHeight = LAMP_DEFAULTS.mountHeight } = {}) {
  const h = mountHeight, ppf = watts * efficacy;
  return (ppf * h * h) / (Math.PI * (h * h + r * r) ** 2);
}

/** DLI (mol/m²/day) a lamp adds at distance r when run `hours` per day. */
export function lampDLI(watts, r, opts = {}) {
  const hours = opts.hours ?? LAMP_DEFAULTS.hours;
  return (lampPPFD(watts, r, opts) * hours * 3600) / 1e6;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) * CELL_M;
/** "A", "A and B", "A, B and C" */
export const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * @param {object} room normalized room
 * @param {Array<{ plant, x, z, monthlyDli: number[] }>} placements
 * @returns {{ lamps: Array, uncovered: Array, deficits: Array, monthsNeeded: number[] }}
 */
export function planLamps(room, placements, options = {}) {
  const o = { ...LAMP_DEFAULTS, ...options };
  const deficits = placements.map((pl) => {
    const worst = Math.min(...pl.monthlyDli);
    return { pl, need: Math.max(0, pl.plant.dli[0] * o.margin - worst), worst };
  });
  const remaining = deficits.map((d) => d.need);
  const lamps = [];
  const candidates = [];
  for (let x = 0; x < room.w; x++) for (let z = 0; z < room.d; z++) for (const watts of o.wattOptions) candidates.push({ x, z, watts });

  const gain = (c, rem) => deficits.reduce((s, d, i) => s + Math.min(rem[i], lampDLI(c.watts, dist(c, d.pl), o)), 0);

  while (lamps.length < o.maxLamps && remaining.some((r) => r > 1e-6)) {
    let best = null;
    for (const c of candidates) {
      const g = gain(c, remaining);
      const score = g / c.watts;
      if (g > 0.05 && (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) < 1e-12 && g > best.g))) best = { ...c, g, score };
    }
    if (!best) break;
    // Prefer the bigger lamp at this spot if it closes more of the gap (score per watt alone favours tiny lamps).
    for (const watts of o.wattOptions) {
      const g = gain({ ...best, watts }, remaining);
      if (g > best.g * 1.25) best = { ...best, watts, g };
    }
    lamps.push({ x: best.x, z: best.z, watts: best.watts });
    deficits.forEach((d, i) => { remaining[i] = Math.max(0, remaining[i] - lampDLI(best.watts, dist(best, d.pl), o)); });
  }

  // Downsize: smallest wattage per lamp that still covers what the plan covers.
  const covered = (ls) => deficits.map((d) => d.need - ls.reduce((s, l) => s + lampDLI(l.watts, dist(l, d.pl), o), 0));
  const target = covered(lamps).map((r) => r <= 1e-6);
  for (const l of lamps) {
    for (const watts of [...o.wattOptions].sort((a, b) => a - b)) {
      if (watts >= l.watts) break;
      const prev = l.watts; l.watts = watts;
      if (covered(lamps).some((r, i) => target[i] && r > 1e-6)) { l.watts = prev; continue; }
      break;
    }
  }

  const short = (pl, m) => pl.monthlyDli[m] < pl.plant.dli[0];
  const monthsNeeded = [];
  for (let m = 0; m < 12; m++) if (placements.some((pl) => short(pl, m))) monthsNeeded.push(m);
  const final = covered(lamps);
  return {
    lamps: lamps.map((l) => {
      const served = deficits.filter((d) => d.need > 0 && lampDLI(l.watts, dist(l, d.pl), o) > 0.25 * d.need);
      // Each lamp only runs in the months one of its own plants is short.
      const months = [];
      for (let m = 0; m < 12; m++) if (served.some((d) => short(d.pl, m))) months.push(m);
      const kWh = (l.watts * o.hours * months.length * 30.4) / 1000;
      return {
        ...l, ppf: Math.round(l.watts * o.efficacy), hours: o.hours, mountHeight: o.mountHeight, months,
        kWhPerYear: Math.round(kWh), costPerYear: Math.round(kWh * o.price * 100) / 100,
        serves: served.map((d) => d.pl.plant.name),
      };
    }),
    // Report a plant as uncovered only if it misses its real minimum, not just the safety margin.
    uncovered: deficits.map((d, i) => ({ plant: d.pl.plant.name, need: d.need, short: final[i] - d.pl.plant.dli[0] * (o.margin - 1) }))
      .filter((u) => u.need > 0 && u.short >= 0.05).map(({ plant, short }) => ({ plant, short })),
    deficits: deficits.map((d) => ({ plant: d.pl.plant.name, worst: d.worst, need: d.need })),
    monthsNeeded,
  };
}

/**
 * Plain-language advice from the simulation and the lamp plan.
 * @param {object} room normalized room
 * @param {object} year simulateYear result
 */
export function lightingAdvice(room, year, placements, plan, { monthNames } = {}) {
  const names = monthNames || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const advice = [];
  if (!room.windows.length) advice.push('No windows: every plant here depends on a grow lamp.');
  for (const l of plan.lamps) {
    const ms = l.months || plan.monthsNeeded;
    const months = ms.length === 12 ? 'all year' : ms.map((m) => names[m]).join(', ');
    advice.push(`${l.watts} W LED (${l.ppf} µmol/s) about ${Math.round(l.mountHeight * 100)} cm above ${listJoin(l.serves) || 'the plants'}, ${l.hours} h a day (${months}). About ${l.kWhPerYear} kWh, $${l.costPerYear.toFixed(2)} a year.`);
  }
  for (const u of plan.uncovered) advice.push(`${u.plant} stays ${u.short.toFixed(1)} mol/m²/day short even with lamps; move it closer to a window.`);
  // Harsh sun: hours of direct sun in the brightest month on non-succulents.
  const peakMonth = year.months.reduce((b, m, i) => (m.sunHours.flat().reduce((a, v) => a + v, 0) > year.months[b].sunHours.flat().reduce((a, v) => a + v, 0) ? i : b), 0);
  for (const pl of placements) {
    const hrs = year.months[peakMonth].sunHours[pl.x][pl.z];
    if (hrs >= 3 && pl.plant.dli[1] < 15) advice.push(`${pl.plant.name} gets ${hrs.toFixed(1)} h of direct sun in ${names[peakMonth]}; a sheer curtain prevents leaf scorch.`);
  }
  if (!advice.length) advice.push('Daylight covers every plant all year; no grow lamp needed.');
  return advice;
}
