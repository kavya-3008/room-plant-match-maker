// "What's wrong with my plant?" as naive Bayes over common houseplant problems.
//
// P(cause | symptoms, context) ∝ P(cause) · Π P(symptom | cause) · Π LR(context fact | cause)
//
// Likelihoods are hand-set from horticultural guidance, not fitted to data, so the output is a ranked
// shortlist with honest uncertainty, not a verdict. Context comes from what the app already knows: the
// simulated light at the plant's spot, its humidity and temperature needs, and how the user waters.
// Symptoms marked absent use (1 - p), softened so one unticked box cannot veto a cause.

export const SYMPTOMS = {
  yellowLower: 'Lower leaves turning yellow',
  yellowAll: 'Yellowing all over',
  brownTips: 'Brown, crispy leaf tips or edges',
  brownSoft: 'Soft brown or black spots',
  wilting: 'Drooping or wilting',
  mushyStem: 'Mushy stem or base',
  leggy: 'Long gaps between leaves, leaning to the window',
  smallLeaves: 'New leaves smaller than old ones',
  leafDrop: 'Dropping healthy-looking leaves',
  bleached: 'Pale, bleached or scorched patches',
  stippling: 'Fine yellow speckles on leaves',
  webbing: 'Fine webbing under leaves',
  cottony: 'White cottony clumps in leaf joints',
  sticky: 'Sticky residue on leaves or furniture',
  gnats: 'Tiny black flies around the soil',
  soilWet: 'Soil stays wet for over a week',
  soilDry: 'Soil pulls away from the pot, bone dry',
  rootsOut: 'Roots growing out of the drainage hole',
  whiteCrust: 'White crust on soil or pot rim',
  curling: 'Leaves curling inwards',
  noGrowth: 'No new growth in the growing season',
  fadedColour: 'Variegation or colour fading',
};

export const CAUSES = {
  overwater: { label: 'Overwatering / root rot', prior: 0.22, fix: 'Let the top third of the soil dry before watering. If roots are brown and mushy, trim them and repot into fresh, airy mix in a pot with drainage.',
    p: { yellowLower: 0.7, yellowAll: 0.35, brownSoft: 0.5, wilting: 0.45, mushyStem: 0.6, leafDrop: 0.3, gnats: 0.25, soilWet: 0.8, noGrowth: 0.3 } },
  underwater: { label: 'Underwatering', prior: 0.15, fix: 'Soak the pot until water runs out of the bottom (bottom-water for 30 min if the soil has shrunk), then water when the top few cm are dry.',
    p: { yellowLower: 0.4, brownTips: 0.55, wilting: 0.75, leafDrop: 0.35, soilDry: 0.8, curling: 0.5, noGrowth: 0.3 } },
  lowLight: { label: 'Not enough light', prior: 0.15, fix: 'Move it closer to a window (light drops fast with distance) or add a grow lamp on a 12 h timer.',
    p: { yellowLower: 0.35, leggy: 0.85, smallLeaves: 0.7, leafDrop: 0.3, noGrowth: 0.6, fadedColour: 0.6, soilWet: 0.4 } },
  sunScorch: { label: 'Sun scorch', prior: 0.05, fix: 'Pull it back from the glass or hang a sheer curtain. Acclimatise plants to direct sun over two weeks.',
    p: { bleached: 0.85, brownTips: 0.4, curling: 0.35, fadedColour: 0.4, soilDry: 0.3 } },
  lowHumidity: { label: 'Dry air', prior: 0.1, fix: 'Group humidity lovers together, use a pebble tray or a humidifier, and keep the plant away from heaters and vents.',
    p: { brownTips: 0.85, curling: 0.5, smallLeaves: 0.2, stippling: 0.1 } },
  spiderMites: { label: 'Spider mites', prior: 0.05, fix: 'Isolate the plant, rinse the leaves in the shower, then treat with insecticidal soap weekly for a month. They thrive in dry air.',
    p: { stippling: 0.85, webbing: 0.7, bleached: 0.3, leafDrop: 0.3, curling: 0.3 } },
  mealybugs: { label: 'Mealybugs', prior: 0.04, fix: 'Dab clumps with 70% isopropyl alcohol on a cotton swab, then treat with insecticidal soap or neem every week until clear.',
    p: { cottony: 0.9, sticky: 0.6, yellowAll: 0.3, noGrowth: 0.3 } },
  aphidsScale: { label: 'Aphids or scale', prior: 0.04, fix: 'Wipe leaves and stems, prune heavily infested growth and treat with insecticidal soap; check new plants before bringing them in.',
    p: { sticky: 0.85, curling: 0.4, yellowAll: 0.25, smallLeaves: 0.3 } },
  fungusGnats: { label: 'Fungus gnats', prior: 0.07, fix: 'Let the soil dry out between waterings, use yellow sticky traps, and water with BTI (mosquito bits) to kill the larvae.',
    p: { gnats: 0.95, soilWet: 0.6 } },
  cold: { label: 'Cold or drafts', prior: 0.04, fix: 'Move it away from doors, AC vents and cold winter glass. Most tropical houseplants want at least 15 °C.',
    p: { leafDrop: 0.7, brownSoft: 0.4, wilting: 0.35, curling: 0.3 } },
  nutrient: { label: 'Nutrient deficiency', prior: 0.05, fix: 'Feed with a balanced liquid fertiliser every 4 weeks in spring and summer. Pale new growth often means nitrogen or iron is short.',
    p: { yellowLower: 0.5, yellowAll: 0.5, smallLeaves: 0.4, noGrowth: 0.5, fadedColour: 0.4 } },
  rootbound: { label: 'Root-bound', prior: 0.04, fix: 'Repot into a pot 2-5 cm wider in spring, loosening the circling roots.',
    p: { rootsOut: 0.9, soilDry: 0.5, wilting: 0.35, noGrowth: 0.4, smallLeaves: 0.3 } },
  salts: { label: 'Salt or fluoride build-up', prior: 0.03, fix: 'Flush the pot with plenty of water every few months, and use rain or filtered water for sensitive plants (spider plants, dracaenas, calatheas).',
    p: { whiteCrust: 0.85, brownTips: 0.65 } },
};

const LEAK = 0.03; // P(symptom | cause) for symptoms a cause does not list
const ABSENT_SOFTEN = 0.6;

/**
 * Turn what the app knows about a plant into likelihood ratios per cause.
 * @param {{ plant, dli?: number, dliMin?: number, rh?: number, tempC?: number, wateringDays?: number,
 *           modelInterval?: number, monthsSinceRepot?: number, monthsSinceFeed?: number, growingSeason?: boolean }} ctx
 */
export function contextEvidence(ctx) {
  const ev = []; // { cause, lr, why }
  const p = ctx.plant;
  if (!p) return ev;
  if (ctx.dli != null) {
    if (ctx.dli < p.dli[0]) ev.push({ cause: 'lowLight', lr: 1 + 3 * Math.min(1, Math.log(p.dli[0] / ctx.dli)), why: `its spot gets about ${ctx.dli.toFixed(1)} mol/m²/day; it wants at least ${p.dli[0]}` });
    else if (ctx.dli > p.dli[1] * 1.3) ev.push({ cause: 'sunScorch', lr: 4, why: `its spot gets about ${ctx.dli.toFixed(1)} mol/m²/day, above its ${p.dli[1]} maximum` });
    else ev.push({ cause: 'lowLight', lr: 0.4, why: 'the simulated light at its spot is within its range' });
  }
  if (ctx.dli != null && ctx.dli < p.dli[0]) ev.push({ cause: 'overwater', lr: 1.4, why: 'plants in low light use less water, so soil stays wet longer' });
  if (ctx.rh != null && ctx.rh < p.rhMin) {
    ev.push({ cause: 'lowHumidity', lr: 3, why: `room humidity ~${ctx.rh}% is below the ${p.rhMin}% it likes` });
    ev.push({ cause: 'spiderMites', lr: 1.8, why: 'spider mites multiply fastest in dry air' });
  }
  if (ctx.tempC != null && ctx.tempC < p.tempMin) ev.push({ cause: 'cold', lr: 5, why: `${ctx.tempC} °C is below its ${p.tempMin} °C minimum` });
  if (ctx.wateringDays && ctx.modelInterval && Number.isFinite(ctx.modelInterval)) {
    const r = ctx.wateringDays / ctx.modelInterval;
    if (r < 0.6) ev.push({ cause: 'overwater', lr: 3, why: `you water every ${ctx.wateringDays} days; the model suggests about every ${Math.round(ctx.modelInterval)}` });
    else if (r > 1.6) ev.push({ cause: 'underwater', lr: 3, why: `you water every ${ctx.wateringDays} days; the model suggests about every ${Math.round(ctx.modelInterval)}` });
    else { ev.push({ cause: 'overwater', lr: 0.6, why: 'your watering rhythm matches the model' }); ev.push({ cause: 'underwater', lr: 0.6, why: 'your watering rhythm matches the model' }); }
  }
  if (ctx.monthsSinceRepot != null && ctx.monthsSinceRepot > 18) {
    ev.push({ cause: 'rootbound', lr: 2, why: `not repotted for ${ctx.monthsSinceRepot} months` });
    ev.push({ cause: 'salts', lr: 1.5, why: 'old potting mix accumulates salts' });
    ev.push({ cause: 'nutrient', lr: 1.4, why: 'old potting mix is depleted' });
  }
  if (ctx.monthsSinceFeed != null && ctx.monthsSinceFeed > 6 && ctx.growingSeason) ev.push({ cause: 'nutrient', lr: 2, why: `not fed for ${ctx.monthsSinceFeed} months` });
  if (p.dryFraction >= 0.85) ev.push({ cause: 'overwater', lr: 1.5, why: `${p.name} is drought-adapted and easily overwatered` });
  if (p.rhMin >= 50) ev.push({ cause: 'lowHumidity', lr: 1.5, why: `${p.name} is a humidity lover` });
  return ev;
}

/**
 * Rank likely causes.
 * @param {string[]} present symptom keys the user sees
 * @param {object} ctx see contextEvidence
 * @param {{ absent?: string[] }} opts symptom keys the user has checked and does not see
 * @returns {Array<{ cause, label, probability, fix, evidence: string[] }>}
 */
export function diagnose(present, ctx = {}, { absent = [] } = {}) {
  for (const s of [...present, ...absent]) if (!(s in SYMPTOMS)) throw new Error(`Unknown symptom: ${s}`);
  const ev = contextEvidence(ctx);
  const rows = Object.entries(CAUSES).map(([cause, c]) => {
    let logp = Math.log(c.prior);
    const why = [];
    for (const s of present) {
      const p = c.p[s] ?? LEAK;
      logp += Math.log(p);
      if (p >= 0.5) why.push(SYMPTOMS[s].toLowerCase());
    }
    for (const s of absent) logp += Math.log(1 - ABSENT_SOFTEN * (c.p[s] ?? LEAK));
    for (const e of ev) if (e.cause === cause) { logp += Math.log(e.lr); if (e.lr > 1) why.push(e.why); }
    return { cause, label: c.label, fix: c.fix, logp, evidence: why };
  });
  const max = Math.max(...rows.map((r) => r.logp));
  const z = rows.reduce((s, r) => s + Math.exp(r.logp - max), 0);
  return rows.map((r) => ({ cause: r.cause, label: r.label, fix: r.fix, evidence: r.evidence, probability: Math.exp(r.logp - max) / z }))
    .sort((a, b) => b.probability - a.probability);
}
