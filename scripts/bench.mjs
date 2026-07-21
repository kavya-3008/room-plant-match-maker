// Timing and quality benchmark for the analysis pipeline.
// Run: node scripts/bench.mjs
import { analyze, DEFAULT_STATE } from '../src/pipeline.js';
import { prepare, simulateYear } from '../src/daylight.js';
import { normalizeRoom } from '../src/floorplan.js';
import { buildProblem, anneal, greedyLayout, scoreLayout } from '../src/optimizer.js';
import { PLANTS } from '../src/plants.js';

const time = (fn, reps = 5) => {
  fn(); // warm up
  const t = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t) / reps;
};

const rooms = {
  'small, one window': { w: 6, d: 6, windows: [{ wall: 'S', pos: 1, width: 3 }] },
  'default': DEFAULT_STATE,
  'large, four windows, furniture': {
    w: 16, d: 16, windows: [{ wall: 'S', pos: 2, width: 6 }, { wall: 'E', pos: 4, width: 4 }, { wall: 'W', pos: 4, width: 4 }, { wall: 'N', pos: 6, width: 4 }],
    furniture: [{ kind: 'sofa', x: 6, z: 10 }, { kind: 'bookshelf', x: 0, z: 0 }, { kind: 'table', x: 7, z: 5 }],
  },
};

console.log('Daylight simulation (12 representative days, 20-minute steps)');
for (const [name, r] of Object.entries(rooms)) {
  const room = normalizeRoom(r);
  const prepMs = time(() => prepare(room));
  const p = prepare(room);
  const yearMs = time(() => simulateYear(p, { lat: 40, cloud: 0.4 }));
  console.log(`  ${name.padEnd(32)} ${room.w}x${room.d} cells  prepare ${prepMs.toFixed(1)} ms  year ${yearMs.toFixed(1)} ms`);
}

console.log('\nPlacement search: greedy start vs simulated annealing (8 plants, 10 seeds)');
for (const [name, r] of Object.entries(rooms)) {
  const room = normalizeRoom(r);
  const light = simulateYear(prepare(room), { lat: 40, cloud: 0.4 });
  const prob = buildProblem(room, light, PLANTS);
  const greedy = scoreLayout(prob, greedyLayout(prob, 8)).total;
  const scores = [];
  const t = performance.now();
  for (let seed = 1; seed <= 10; seed++) scores.push(anneal(prob, { maxPlants: 8, seed, iterations: 5000 }).score);
  const per = (performance.now() - t) / 10;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  ${name.padEnd(32)} greedy ${greedy.toFixed(3)}  annealed mean ${mean.toFixed(3)} (min ${Math.min(...scores).toFixed(3)}, max ${Math.max(...scores).toFixed(3)})  ${per.toFixed(0)} ms/run`);
}

console.log('\nFull pipeline');
for (const [name, r] of Object.entries(rooms)) {
  const ms = time(() => analyze({ ...DEFAULT_STATE, ...r }), 3);
  console.log(`  ${name.padEnd(32)} ${ms.toFixed(0)} ms`);
}
