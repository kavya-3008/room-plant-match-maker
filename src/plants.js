// Plant database.
//
// light      [min, max] light class (0 low, 1 medium, 2 bright, 3 direct sun), used by the quick heuristic.
// dli        [min, max] daily light integral in mol/m²/day the plant does well in. Ranges are rules of thumb
//            gathered from extension-service guidance; real tolerance depends on acclimation and cultivar.
// water      days between waterings in reference conditions (15 cm pot, DLI 5, 21 °C, 45% RH). The care
//            model scales this, it is not used as-is.
// kc         relative water use (transpiration) vs. typical tropical foliage = 1.
// dryFraction  share of the pot's available water to use up before watering again (0.25 keep moist ... 0.95 dry out fully).
// tempMin    °C below which it is stressed. rhMin: relative humidity % it wants at least.
// height, spread  typical indoor size at maturity, metres.
// toxin      null if the ASPCA lists it as non-toxic to cats and dogs; otherwise the toxic principle.
// model      voxel look: kind + colors + height in sub-voxels (see plantModels.js).

const RAW = [
  { id: 'snake', name: 'Snake plant', sci: 'Dracaena trifasciata', light: [0, 2], dli: [1.5, 12], water: 14, kc: 0.4, dryFraction: 0.9, humidity: 'low', rhMin: 25, tempMin: 10, height: 0.9, spread: 0.4, toxin: 'saponins', difficulty: 1, growth: 'slow',
    model: { kind: 'blades', color: 0x2f6b3a, accent: 0xd9c94a, h: 8 }, tip: 'Let the soil dry out fully. Overwatering is the main way to kill it.' },
  { id: 'zz', name: 'ZZ plant', sci: 'Zamioculcas zamiifolia', light: [0, 2], dli: [1, 10], water: 14, kc: 0.45, dryFraction: 0.9, humidity: 'low', rhMin: 25, tempMin: 12, height: 0.8, spread: 0.6, toxin: 'calcium oxalate crystals', difficulty: 1, growth: 'slow',
    model: { kind: 'blades', color: 0x1f5a2e, accent: 0x2f7a3e, h: 7 }, tip: 'Stores water in its rhizomes; happily ignored for weeks.' },
  { id: 'pothos', name: 'Pothos', sci: 'Epipremnum aureum', light: [0, 2], dli: [2, 10], water: 7, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 35, tempMin: 15, height: 0.4, spread: 0.6, toxin: 'insoluble calcium oxalates', difficulty: 1, growth: 'fast', trailing: true,
    model: { kind: 'vine', color: 0x3f9a45, accent: 0xb9d94a, h: 5 }, tip: 'Water when the top 2-3 cm are dry. Trim vines to keep it full.' },
  { id: 'castiron', name: 'Cast iron plant', sci: 'Aspidistra elatior', light: [0, 1], dli: [1, 5], water: 10, kc: 0.6, dryFraction: 0.6, humidity: 'low', rhMin: 25, tempMin: 5, height: 0.7, spread: 0.6, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'blades', color: 0x1d4d2b, accent: 0x1d4d2b, h: 7 }, tip: 'Nearly indestructible in dim corners. Keep out of direct sun.' },
  { id: 'spider', name: 'Spider plant', sci: 'Chlorophytum comosum', light: [1, 2], dli: [4, 12], water: 7, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 35, tempMin: 10, height: 0.4, spread: 0.6, toxin: null, difficulty: 1, growth: 'fast',
    model: { kind: 'blades', color: 0x6fb04a, accent: 0xe8f0c0, h: 6 }, tip: 'Brown tips usually mean fluoride in tap water; use filtered water.' },
  { id: 'palm', name: 'Parlor palm', sci: 'Chamaedorea elegans', light: [0, 2], dli: [2, 8], water: 7, kc: 0.9, dryFraction: 0.45, humidity: 'med', rhMin: 40, tempMin: 13, height: 1.2, spread: 0.6, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'bush', color: 0x3f8f45, accent: 0x5faa55, h: 9 }, tip: 'Slow grower that tolerates low light; keep the soil lightly moist.' },
  { id: 'boston', name: 'Boston fern', sci: 'Nephrolepis exaltata', light: [1, 2], dli: [4, 10], water: 3, kc: 1.3, dryFraction: 0.25, humidity: 'high', rhMin: 50, tempMin: 13, height: 0.6, spread: 0.8, toxin: null, difficulty: 2, growth: 'medium',
    model: { kind: 'bush', color: 0x4aa84e, accent: 0x6cc462, h: 7 }, tip: 'Likes humidity and constantly damp soil. Mist or group with other plants.' },
  { id: 'peace', name: 'Peace lily', sci: 'Spathiphyllum', light: [0, 1], dli: [2, 7], water: 7, kc: 1.2, dryFraction: 0.5, humidity: 'high', rhMin: 40, tempMin: 15, height: 0.6, spread: 0.5, toxin: 'insoluble calcium oxalates', difficulty: 1, growth: 'medium',
    model: { kind: 'blades', color: 0x24663a, accent: 0xffffff, h: 7, flower: true }, tip: 'Droops dramatically when thirsty, then recovers within hours of watering.' },
  { id: 'monstera', name: 'Monstera', sci: 'Monstera deliciosa', light: [1, 2], dli: [5, 15], water: 8, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 15, height: 2.0, spread: 1.2, toxin: 'insoluble calcium oxalates', difficulty: 2, growth: 'fast',
    model: { kind: 'broad', color: 0x2f8a3c, accent: 0x3fa84c, h: 10 }, tip: 'Give it a moss pole. Bright, indirect light produces the split leaves.' },
  { id: 'rubber', name: 'Rubber plant', sci: 'Ficus elastica', light: [2, 3], dli: [6, 18], water: 8, kc: 0.9, dryFraction: 0.55, humidity: 'med', rhMin: 35, tempMin: 13, height: 2.0, spread: 0.8, toxin: 'ficin and ficusin (sap)', difficulty: 2, growth: 'medium',
    model: { kind: 'broad', color: 0x1e4d2a, accent: 0x4a2a38, h: 12 }, tip: 'Wipe the leaves occasionally; rotate it so it grows evenly.' },
  { id: 'fiddle', name: 'Fiddle leaf fig', sci: 'Ficus lyrata', light: [2, 3], dli: [8, 20], water: 7, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 15, height: 2.2, spread: 0.9, toxin: 'ficin and ficusin (sap)', difficulty: 3, growth: 'medium',
    model: { kind: 'broad', color: 0x3a8a3a, accent: 0x4fa347, h: 13 }, tip: 'Fussy: hates being moved, drafts, and soggy soil. Bright spot, steady routine.' },
  { id: 'calathea', name: 'Prayer plant', sci: 'Maranta leuconeura', light: [1, 1], dli: [3, 7], water: 5, kc: 1.2, dryFraction: 0.3, humidity: 'high', rhMin: 50, tempMin: 16, height: 0.3, spread: 0.4, toxin: null, difficulty: 3, growth: 'medium',
    model: { kind: 'broad', color: 0x4f8a3a, accent: 0xb04a4a, h: 6 }, tip: 'Wants humidity and soft water; folds its leaves up at night.' },
  { id: 'aloe', name: 'Aloe vera', sci: 'Aloe vera', light: [2, 3], dli: [10, 25], water: 14, kc: 0.3, dryFraction: 0.95, humidity: 'low', rhMin: 20, tempMin: 10, height: 0.5, spread: 0.4, toxin: 'saponins and anthraquinones', difficulty: 1, growth: 'medium',
    model: { kind: 'rosette', color: 0x6fae6a, accent: 0xd8e8c8, h: 6 }, tip: 'Water deeply but rarely. Mushy leaves mean too much water.' },
  { id: 'haworthia', name: 'Haworthia', sci: 'Haworthiopsis attenuata', light: [1, 3], dli: [5, 15], water: 14, kc: 0.25, dryFraction: 0.95, humidity: 'low', rhMin: 20, tempMin: 7, height: 0.15, spread: 0.15, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'rosette', color: 0x2f7a4a, accent: 0xeeeeee, h: 4 }, tip: 'A compact, pet-safe succulent that copes with less light than most.' },
  { id: 'echeveria', name: 'Echeveria', sci: 'Echeveria elegans', light: [3, 3], dli: [12, 30], water: 14, kc: 0.3, dryFraction: 0.95, humidity: 'low', rhMin: 20, tempMin: 7, height: 0.15, spread: 0.2, toxin: null, difficulty: 2, growth: 'slow',
    model: { kind: 'rosette', color: 0x8fb8c8, accent: 0xd68ab0, h: 3 }, tip: 'Needs a lot of direct sun or it stretches out and fades.' },
  { id: 'barrel', name: 'Barrel cactus', sci: 'Echinocactus grusonii', light: [3, 3], dli: [15, 40], water: 21, kc: 0.2, dryFraction: 0.95, humidity: 'low', rhMin: 15, tempMin: 7, height: 0.4, spread: 0.4, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'column', color: 0x4f9a4a, accent: 0xf0d84a, h: 6 }, tip: 'Full sun and very little water, especially in winter.' },
  { id: 'basil', name: 'Basil', sci: 'Ocimum basilicum', light: [3, 3], dli: [12, 25], water: 2, kc: 1.5, dryFraction: 0.35, humidity: 'med', rhMin: 40, tempMin: 12, height: 0.4, spread: 0.3, toxin: null, difficulty: 2, growth: 'fast', edible: true,
    model: { kind: 'bush', color: 0x4aa83e, accent: 0x6cc84a, h: 6 }, tip: 'Pinch the tips to keep it bushy; it wilts fast in dry soil.' },

  { id: 'aglaonema', name: 'Chinese evergreen', sci: 'Aglaonema commutatum', dli: [1.5, 6], water: 9, kc: 0.8, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 15, height: 0.6, spread: 0.5, toxin: 'insoluble calcium oxalates', difficulty: 1, growth: 'slow',
    model: { kind: 'blades', color: 0x3c7a4a, accent: 0xc9d8b8, h: 6 }, tip: 'One of the best plants for a dim room. Keep it away from cold drafts.' },
  { id: 'philodendron', name: 'Heartleaf philodendron', sci: 'Philodendron hederaceum', dli: [2, 10], water: 7, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 15, height: 0.4, spread: 0.6, toxin: 'insoluble calcium oxalates', difficulty: 1, growth: 'fast', trailing: true,
    model: { kind: 'vine', color: 0x2f8a3a, accent: 0x5fb04a, h: 5 }, tip: 'Forgiving trailer; leaves shrink and spacing stretches when light is too low.' },
  { id: 'dracaena', name: 'Dragon tree', sci: 'Dracaena marginata', dli: [4, 12], water: 10, kc: 0.7, dryFraction: 0.6, humidity: 'low', rhMin: 30, tempMin: 13, height: 1.8, spread: 0.6, toxin: 'saponins', difficulty: 1, growth: 'slow',
    model: { kind: 'tree', color: 0x2f6b3a, accent: 0xb04a4a, h: 13 }, tip: 'Sensitive to fluoride: brown leaf tips are common with hard tap water.' },
  { id: 'hoya', name: 'Wax plant', sci: 'Hoya carnosa', dli: [6, 15], water: 10, kc: 0.5, dryFraction: 0.75, humidity: 'med', rhMin: 40, tempMin: 10, height: 0.3, spread: 0.6, toxin: null, difficulty: 2, growth: 'slow', trailing: true,
    model: { kind: 'vine', color: 0x2f6b3a, accent: 0xf0c8d8, h: 4 }, tip: 'Blooms on old flower spurs; do not cut them off. Likes to be a bit root-bound.' },
  { id: 'strelitzia', name: 'Bird of paradise', sci: 'Strelitzia reginae', dli: [12, 30], water: 7, kc: 1.1, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 10, height: 1.8, spread: 1.0, toxin: 'hydrocyanic acid (seeds and fruit)', difficulty: 2, growth: 'medium',
    model: { kind: 'broad', color: 0x2f7a5a, accent: 0xf28a2a, h: 12 }, tip: 'Needs the sunniest spot you have; leaf splits are natural, not damage.' },
  { id: 'pearls', name: 'String of pearls', sci: 'Curio rowleyanus', dli: [8, 20], water: 14, kc: 0.35, dryFraction: 0.85, humidity: 'low', rhMin: 20, tempMin: 10, height: 0.15, spread: 0.3, toxin: 'pyrrolizidine alkaloids', difficulty: 2, growth: 'medium', trailing: true,
    model: { kind: 'pearls', color: 0x6fae5a, accent: 0x8fcf6a, h: 3 }, tip: 'Water when the pearls look slightly wrinkled; shallow pots drain best.' },
  { id: 'jade', name: 'Jade plant', sci: 'Crassula ovata', dli: [10, 25], water: 14, kc: 0.3, dryFraction: 0.9, humidity: 'low', rhMin: 20, tempMin: 7, height: 0.8, spread: 0.6, toxin: 'unknown principle (ASPCA lists as toxic)', difficulty: 1, growth: 'slow',
    model: { kind: 'tree', color: 0x4f9a4a, accent: 0xb04a4a, h: 8 }, tip: 'Red leaf edges are a sign of plenty of sun, not a problem.' },
  { id: 'orbifolia', name: 'Calathea orbifolia', sci: 'Goeppertia orbifolia', dli: [3, 7], water: 5, kc: 1.2, dryFraction: 0.3, humidity: 'high', rhMin: 55, tempMin: 16, height: 0.6, spread: 0.6, toxin: null, difficulty: 3, growth: 'medium',
    model: { kind: 'broad', color: 0x5f9a4a, accent: 0xa8c88a, h: 7 }, tip: 'Crispy edges mean dry air; it is one of the thirstiest plants for humidity.' },
  { id: 'ponytail', name: 'Ponytail palm', sci: 'Beaucarnea recurvata', dli: [10, 25], water: 18, kc: 0.3, dryFraction: 0.9, humidity: 'low', rhMin: 20, tempMin: 7, height: 1.2, spread: 0.6, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'tree', color: 0x4a8a3a, accent: 0x8a6a4a, h: 10 }, tip: 'The swollen trunk stores water; treat it like a succulent.' },
  { id: 'peperomia', name: 'Baby rubber plant', sci: 'Peperomia obtusifolia', dli: [3, 10], water: 10, kc: 0.6, dryFraction: 0.7, humidity: 'med', rhMin: 35, tempMin: 13, height: 0.3, spread: 0.3, toxin: null, difficulty: 1, growth: 'slow',
    model: { kind: 'rosette', color: 0x2f7a3a, accent: 0x4f9a4a, h: 5 }, tip: 'Semi-succulent leaves: err on the dry side.' },
  { id: 'fittonia', name: 'Nerve plant', sci: 'Fittonia albivenis', dli: [2, 6], water: 3, kc: 1.3, dryFraction: 0.25, humidity: 'high', rhMin: 60, tempMin: 16, height: 0.15, spread: 0.3, toxin: null, difficulty: 2, growth: 'medium',
    model: { kind: 'bush', color: 0x3a7a3a, accent: 0xe88aa0, h: 3 }, tip: 'Faints when dry and revives after watering; a terrarium keeps it happiest.' },
  { id: 'areca', name: 'Areca palm', sci: 'Dypsis lutescens', dli: [6, 15], water: 6, kc: 1.2, dryFraction: 0.4, humidity: 'med', rhMin: 40, tempMin: 13, height: 2.0, spread: 1.0, toxin: null, difficulty: 2, growth: 'medium',
    model: { kind: 'bush', color: 0x6aa84a, accent: 0xb8c84a, h: 12 }, tip: 'Big, pet-safe statement palm. Flush the soil now and then to avoid salt build-up.' },
  { id: 'pilea', name: 'Chinese money plant', sci: 'Pilea peperomioides', dli: [5, 12], water: 7, kc: 0.8, dryFraction: 0.6, humidity: 'med', rhMin: 35, tempMin: 10, height: 0.3, spread: 0.3, toxin: null, difficulty: 1, growth: 'medium',
    model: { kind: 'tree', color: 0x4f9a3a, accent: 0x6fb84a, h: 6 }, tip: 'Leans hard towards light: rotate it weekly. Easy to propagate from pups.' },
  { id: 'nidus', name: "Bird's nest fern", sci: 'Asplenium nidus', dli: [2, 8], water: 6, kc: 1.1, dryFraction: 0.35, humidity: 'high', rhMin: 50, tempMin: 15, height: 0.5, spread: 0.6, toxin: null, difficulty: 2, growth: 'slow',
    model: { kind: 'blades', color: 0x5fa84a, accent: 0x3a6a2a, h: 6 }, tip: 'Water around the rosette, not into its centre, to avoid crown rot.' },
  { id: 'phalaenopsis', name: 'Moth orchid', sci: 'Phalaenopsis', dli: [4, 10], water: 7, kc: 0.6, dryFraction: 0.7, humidity: 'med', rhMin: 45, tempMin: 16, height: 0.5, spread: 0.3, toxin: null, difficulty: 2, growth: 'slow',
    model: { kind: 'orchid', color: 0x3a7a3a, accent: 0xf0a8d8, h: 7 }, tip: 'Grow in bark, water when the roots turn silvery. A cooler night sets new spikes.' },
  { id: 'violet', name: 'African violet', sci: 'Saintpaulia ionantha', dli: [4, 9], water: 5, kc: 0.9, dryFraction: 0.4, humidity: 'med', rhMin: 45, tempMin: 16, height: 0.15, spread: 0.25, toxin: null, difficulty: 2, growth: 'slow',
    model: { kind: 'orchid', color: 0x2f6a3a, accent: 0x9a5ad8, h: 3 }, tip: 'Water from below with room-temperature water; cold water spots the leaves.' },
  { id: 'schlumbergera', name: 'Christmas cactus', sci: 'Schlumbergera bridgesii', dli: [5, 12], water: 10, kc: 0.5, dryFraction: 0.6, humidity: 'med', rhMin: 40, tempMin: 10, height: 0.3, spread: 0.5, toxin: null, difficulty: 1, growth: 'slow', trailing: true,
    model: { kind: 'vine', color: 0x3f8a3a, accent: 0xe84a7a, h: 4 }, tip: 'A forest cactus, not a desert one: likes more water and less sun than you would think.' },
  { id: 'ivy', name: 'English ivy', sci: 'Hedera helix', dli: [3, 10], water: 6, kc: 1.0, dryFraction: 0.45, humidity: 'med', rhMin: 40, tempMin: 5, height: 0.3, spread: 0.6, toxin: 'triterpenoid saponins', difficulty: 2, growth: 'fast', trailing: true,
    model: { kind: 'vine', color: 0x1f5a2a, accent: 0xd8e0c0, h: 4 }, tip: 'Prefers it cool. Warm, dry rooms invite spider mites.' },
  { id: 'dieffenbachia', name: 'Dumb cane', sci: 'Dieffenbachia seguine', dli: [2, 8], water: 7, kc: 1.0, dryFraction: 0.5, humidity: 'med', rhMin: 40, tempMin: 16, height: 1.2, spread: 0.6, toxin: 'insoluble calcium oxalates', difficulty: 2, growth: 'medium',
    model: { kind: 'broad', color: 0x4f9a3a, accent: 0xd8e8a8, h: 9 }, tip: 'Sap irritates mouth and skin; wear gloves when pruning.' },
  { id: 'croton', name: 'Croton', sci: 'Codiaeum variegatum', dli: [10, 25], water: 6, kc: 1.1, dryFraction: 0.4, humidity: 'high', rhMin: 50, tempMin: 15, height: 1.0, spread: 0.6, toxin: 'diterpene esters (sap)', difficulty: 3, growth: 'medium',
    model: { kind: 'tree', color: 0xc8782a, accent: 0xd8c82a, h: 9 }, tip: 'The colours fade in low light. Drops leaves when moved; let it settle.' },
  { id: 'rosemary', name: 'Rosemary', sci: 'Salvia rosmarinus', dli: [15, 30], water: 6, kc: 0.8, dryFraction: 0.6, humidity: 'low', rhMin: 25, tempMin: 2, height: 0.6, spread: 0.4, toxin: null, difficulty: 3, growth: 'medium', edible: true,
    model: { kind: 'bush', color: 0x3f6a4a, accent: 0x8aa8c8, h: 7 }, tip: 'Indoors it needs a south window or a lamp, plus good airflow against mildew.' },
];

const classOfDli = (v) => [2, 5, 10].filter((t) => v >= t).length;

/** All plants, with `light` derived from `dli` when a record does not state it. */
export const PLANTS = RAW.map((p) => ({ ...p, petSafe: p.toxin === null, light: p.light ?? [classOfDli(p.dli[0]), Math.min(3, classOfDli(p.dli[1]))] }));
export const PLANT_BY_ID = Object.fromEntries(PLANTS.map((p) => [p.id, p]));
