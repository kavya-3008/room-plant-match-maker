// Watering and feeding schedule from a daily soil-water balance.
//
// Each pot is a bucket. Its capacity is the potting mix's available water (volume × available-water fraction).
// Every day the plant uses ET litres; when the used share reaches the plant's `dryFraction`, it is watered.
//
// ET is calibrated, not invented: a plant's catalogue `water` interval is taken as true in reference
// conditions (15 cm plastic pot of the plant's usual mix, DLI 5, 21 °C, 45% RH), so
//     ET_ref = AW_ref × dryFraction / water
// and actual ET scales from there with light (transpiration rises sub-linearly with light), vapour pressure
// deficit (drier, warmer air pulls more water), pot size (leaf area ~ pot area), pot material (terracotta and
// fabric lose water through their walls) and season (most houseplants slow down in winter).
// The output is a starting schedule; the finger test on the soil always wins.

const REF = { dli: 5, tempC: 21, rh: 45, potCm: 15 };

export const MIXES = {
  standard: { label: 'Standard potting mix', awc: 0.25 },
  gritty: { label: 'Gritty cactus mix', awc: 0.12 },
  moisture: { label: 'Moisture-retaining mix', awc: 0.35 },
  bark: { label: 'Orchid bark', awc: 0.15 },
};
export const POT_MATERIALS = {
  plastic: { label: 'Plastic', factor: 1.0 },
  glazed: { label: 'Glazed ceramic', factor: 1.05 },
  terracotta: { label: 'Terracotta', factor: 1.35 },
  fabric: { label: 'Fabric grow bag', factor: 1.5 },
};

/** Saturation vapour pressure, kPa (Tetens). */
export function svp(tempC) {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}
/** Vapour pressure deficit, kPa. */
export function vpd(tempC, rh) {
  return svp(tempC) * (1 - rh / 100);
}
const VPD_REF = vpd(REF.tempC, REF.rh);

/** Volume (L) of a standard pot: height ≈ 0.9 × top diameter, treated as a cylinder. */
export function potVolume(diameterCm) {
  const r = diameterCm / 2;
  return (Math.PI * r * r * 0.9 * diameterCm) / 1000;
}
export function availableWater(diameterCm, mix = 'standard') {
  return potVolume(diameterCm) * MIXES[mix].awc;
}

/** Default pot for a plant: size from mature spread, mix from how dry it likes to be. */
export function defaultPot(plant) {
  const diameterCm = Math.round(Math.min(35, Math.max(10, plant.spread * 30)) / 2) * 2;
  const mix = plant.dryFraction >= 0.85 ? 'gritty' : plant.model.kind === 'orchid' && plant.id === 'phalaenopsis' ? 'bark' : 'standard';
  return { diameterCm, mix, material: 'plastic' };
}

/** Growing-season months (0-11) for the hemisphere: Mar-Sep in the north, Sep-Mar in the south. */
export function growingMonths(lat) {
  const north = [2, 3, 4, 5, 6, 7, 8];
  return lat >= 0 ? north : north.map((m) => (m + 6) % 12);
}

/**
 * Typical indoor climate per month. Heating dries winter air; summer is warmer and more humid.
 * Override with { temp: [12], rh: [12] } when you know your home.
 */
export function indoorClimate(lat, override = {}) {
  const north = { temp: [20, 20, 21, 21, 22, 23, 24, 24, 23, 21, 20, 20], rh: [30, 30, 35, 40, 45, 50, 55, 55, 50, 40, 35, 30] };
  const shift = (a) => (lat >= 0 ? a : a.map((_, m) => a[(m + 6) % 12]));
  return { temp: override.temp || shift(north.temp), rh: override.rh || shift(north.rh) };
}

/**
 * Daily water use (L/day) for a plant in given conditions.
 * @param {object} plant
 * @param {{ dli: number, tempC: number, rh: number, pot: object, growing: boolean }} c
 */
export function dailyUse(plant, { dli, tempC, rh, pot, growing = true }) {
  // The catalogue interval assumes the plant's usual mix (a cactus in gritty mix, not in standard soil).
  const awRef = availableWater(REF.potCm, defaultPot(plant).mix);
  const etRef = (awRef * plant.dryFraction) / plant.water;
  // CAM succulents keep stomata shut in the day, so their use tracks light much less.
  const lightExp = plant.kc < 0.5 ? 0.3 : 0.7;
  const fLight = Math.min(3, Math.max(0.3, 0.35 + 0.65 * (Math.max(dli, 0.1) / REF.dli) ** lightExp));
  const fVpd = 0.4 + 0.6 * (vpd(tempC, rh) / VPD_REF);
  const fSize = (pot.diameterCm / REF.potCm) ** 2;
  const fMat = POT_MATERIALS[pot.material].factor;
  const fSeason = growing ? 1 : 0.75;
  return etRef * fLight * fVpd * fSize * fMat * fSeason;
}

const DAY = 86400000;
export const utcDate = (y, m, d) => new Date(Date.UTC(y, m, d));
export const addDays = (date, n) => new Date(date.getTime() + n * DAY);
export const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * Simulate one pot for `days` days, starting just after a watering.
 * @param {object} pl placement { plant, monthlyDli: number[12] }
 * @param {{ start: Date, days: number, lat: number, climate?: object, pot?: object, choreDays?: number[] }} o
 *   choreDays: allowed weekdays (0 = Sunday). Waterings move to the last chore day before the pot would run dry.
 */
export function simulatePot(pl, { start, days = 56, lat = 35, climate, pot, choreDays } = {}) {
  const plant = pl.plant;
  const p = { ...defaultPot(plant), ...(pot || {}) };
  const cl = climate || indoorClimate(lat);
  const grow = new Set(growingMonths(lat));
  const AW = availableWater(p.diameterCm, p.mix);
  const limit = AW * plant.dryFraction;
  const useOn = (date) => {
    const m = date.getUTCMonth();
    return dailyUse(plant, { dli: pl.monthlyDli ? pl.monthlyDli[m] : pl.dli ?? REF.dli, tempC: cl.temp[m], rh: cl.rh[m], pot: p, growing: grow.has(m) });
  };
  const chores = choreDays && choreDays.length ? new Set(choreDays) : null;
  const events = [];
  let depleted = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    depleted += useOn(date);
    let water = false, offSchedule = false;
    if (chores) {
      if (chores.has(date.getUTCDay())) {
        // Water now if it would hit the limit before the next chore day.
        let ahead = depleted, k = 1;
        for (; k <= 7; k++) { const nd = addDays(date, k); ahead += useOn(nd); if (chores.has(nd.getUTCDay())) break; }
        if (ahead >= limit) water = true;
      } else if (depleted >= limit * 1.15) { water = true; offSchedule = true; } // cannot wait any longer
    } else if (depleted >= limit) water = true;
    if (water) {
      events.push({ day: d, date: isoDay(date), ml: Math.round(depleted * 1.2 * 1000), offSchedule });
      depleted = 0;
    }
  }
  const gaps = events.map((e, i) => e.day - (i ? events[i - 1].day : -1));
  return {
    plant: plant.name, pot: p, events,
    averageInterval: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity,
    capacityMl: Math.round(AW * 1000), limitMl: Math.round(limit * 1000),
  };
}

/** Feeding dates: every 4 weeks in the growing season (8 weeks, half strength, for slow growers and succulents). */
export function feedingPlan(pl, { start, days = 56, lat = 35 } = {}) {
  const grow = new Set(growingMonths(lat));
  const slow = pl.plant.growth === 'slow' || pl.plant.kc < 0.5;
  const every = slow ? 56 : 28;
  const out = [];
  for (let d = 6; d < days; d += every) {
    const date = addDays(start, d);
    if (grow.has(date.getUTCMonth())) out.push({ day: d, date: isoDay(date), strength: slow ? 'half' : 'full' });
  }
  return out;
}

/**
 * Whole-room schedule merged by date.
 * @returns {{ days: Array<{ date, water: Array, feed: Array }>, perPlant: Array }}
 */
export function buildSchedule(placements, opts = {}) {
  const start = opts.start || utcDate(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const o = { ...opts, start };
  const perPlant = placements.map((pl, i) => ({ ...simulatePot(pl, { ...o, pot: opts.pots?.[i] }), feed: feedingPlan(pl, o) }));
  const byDate = new Map();
  const slot = (date) => { if (!byDate.has(date)) byDate.set(date, { date, water: [], feed: [] }); return byDate.get(date); };
  perPlant.forEach((pp) => {
    pp.events.forEach((e) => slot(e.date).water.push({ plant: pp.plant, ml: e.ml, offSchedule: e.offSchedule }));
    pp.feed.forEach((f) => slot(f.date).feed.push({ plant: pp.plant, strength: f.strength }));
  });
  return { start: isoDay(start), days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), perPlant };
}

// ---------- iCalendar (RFC 5545) ----------

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line to 75 octets per line (UTF-8), continuation lines start with a space. */
export function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const max = out.length ? 74 : 75; // continuation lines lose one octet to the leading space
    if (bytes + b > max) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n');
}

const icsDate = (iso) => iso.replace(/-/g, '');

/**
 * Export a schedule as an .ics calendar with one all-day event per date.
 * @param {{ days: Array }} schedule from buildSchedule
 * @param {{ stamp?: Date, name?: string }} opts stamp makes output deterministic for tests
 */
export function toICS(schedule, { stamp = new Date(), name = 'Plant care' } = {}) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Room Plant Matchmaker//Care schedule//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(name)}`];
  for (const d of schedule.days) {
    const parts = [];
    if (d.water.length) parts.push(`Water: ${d.water.map((w) => w.plant).join(', ')}`);
    if (d.feed.length) parts.push(`Feed: ${d.feed.map((f) => f.plant).join(', ')}`);
    const desc = [
      ...d.water.map((w) => `${w.plant}: about ${w.ml} ml${w.offSchedule ? ' (could not wait for a chore day)' : ''}`),
      ...d.feed.map((f) => `${f.plant}: ${f.strength}-strength fertiliser`),
      'Check the soil first: water only if it feels dry to the depth the plant likes.',
    ].join('\n');
    const next = isoDay(addDays(new Date(d.date + 'T00:00:00Z'), 1));
    lines.push('BEGIN:VEVENT', `UID:${icsDate(d.date)}-care@room-plant-matchmaker`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d.date)}`, `DTEND;VALUE=DATE:${icsDate(next)}`,
      `SUMMARY:${icsEscape(parts.join(' · '))}`, `DESCRIPTION:${icsEscape(desc)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
