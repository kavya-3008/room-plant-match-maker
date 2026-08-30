import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, contextEvidence, SYMPTOMS, CAUSES } from '../src/diagnose.js';
import { encodeState, decodeState, crc32, toBase64Url, fromBase64Url } from '../src/share.js';
import { PLANT_BY_ID } from '../src/plants.js';

const top = (r) => r[0].cause;

test('every cause lists only known symptoms and priors are sane', () => {
  for (const [k, c] of Object.entries(CAUSES)) {
    for (const s of Object.keys(c.p)) assert.ok(s in SYMPTOMS, `${k}.${s}`);
    assert.ok(c.prior > 0 && c.prior < 0.5);
  }
});

test('posterior is a probability distribution', () => {
  const r = diagnose(['wilting']);
  assert.ok(Math.abs(r.reduce((s, x) => s + x.probability, 0) - 1) < 1e-9);
  assert.ok(r.every((x, i) => i === 0 || x.probability <= r[i - 1].probability));
});

test('classic root rot', () => {
  const r = diagnose(['yellowLower', 'mushyStem', 'soilWet', 'wilting'], { plant: PLANT_BY_ID.snake });
  assert.equal(top(r), 'overwater');
  assert.ok(r[0].probability > 0.8);
});

test('thirsty plant', () => {
  assert.equal(top(diagnose(['wilting', 'soilDry', 'curling'], { plant: PLANT_BY_ID.pothos })), 'underwater');
});

test('pests are recognised by their signs', () => {
  assert.equal(top(diagnose(['stippling', 'webbing'])), 'spiderMites');
  assert.equal(top(diagnose(['cottony', 'sticky'])), 'mealybugs');
  assert.equal(top(diagnose(['gnats'])), 'fungusGnats');
});

test('context from the light simulation tips an ambiguous case', () => {
  const symptoms = ['yellowLower', 'noGrowth'];
  const dark = diagnose(symptoms, { plant: PLANT_BY_ID.monstera, dli: 1.5 });
  const bright = diagnose(symptoms, { plant: PLANT_BY_ID.monstera, dli: 9 });
  const pDark = dark.find((x) => x.cause === 'lowLight').probability, pBright = bright.find((x) => x.cause === 'lowLight').probability;
  assert.ok(pDark > 2 * pBright);
  assert.ok(dark.find((x) => x.cause === 'lowLight').evidence.some((e) => e.includes('mol/m²/day')));
});

test('brown tips on a calathea in dry air point to humidity', () => {
  const r = diagnose(['brownTips', 'curling'], { plant: PLANT_BY_ID.calathea, rh: 30 });
  assert.equal(top(r), 'lowHumidity');
});

test('watering rhythm is compared with the care model', () => {
  const ev = contextEvidence({ plant: PLANT_BY_ID.pothos, wateringDays: 2, modelInterval: 8 });
  assert.ok(ev.some((e) => e.cause === 'overwater' && e.lr > 1));
  const r = diagnose(['yellowLower'], { plant: PLANT_BY_ID.pothos, wateringDays: 2, modelInterval: 8 });
  assert.equal(top(r), 'overwater');
});

test('absent symptoms lower a cause without vetoing it', () => {
  const withGnatsUnknown = diagnose(['soilWet']).find((x) => x.cause === 'fungusGnats').probability;
  const noGnats = diagnose(['soilWet'], {}, { absent: ['gnats'] }).find((x) => x.cause === 'fungusGnats');
  assert.ok(noGnats.probability < withGnatsUnknown && noGnats.probability > 0);
});

test('unknown symptoms are rejected', () => {
  assert.throws(() => diagnose(['purpleSpots']), /Unknown symptom/);
});

// ---------- share links ----------

const sample = {
  w: 12, d: 9, rotation: 35, lat: -33.87, month: 6, cloud: 0.55, pets: true, edibleOnly: false, exp: 2, n: 7,
  windows: [
    { wall: 'N', pos: 2, width: 4, sill: 0.9, head: 2.1, overhang: 0.6, obstruction: 20, curtain: 0.3, glazing: 'lowE' },
    { wall: 'E', pos: 1, width: 2, sill: 0.5, head: 2.0, overhang: 0, obstruction: 0, curtain: 0, glazing: 'single' },
  ],
  doors: [{ wall: 'W', pos: 3, width: 2 }],
  furniture: [{ kind: 'sofa', x: 4, z: 5, w: 4, d: 2 }, { kind: 'bookshelf', x: 0, z: 0, w: 2, d: 1 }],
  choreDays: [0, 3, 6],
};

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('base64url round-trips arbitrary bytes without padding or unsafe characters', () => {
  const bytes = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) & 255);
  const s = toBase64Url(bytes);
  assert.ok(!/[+/=]/.test(s));
  assert.deepEqual(fromBase64Url(s), bytes);
});

test('state survives an encode/decode round trip', () => {
  const code = encodeState(sample);
  const r = decodeState(code);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.state, sample);
  assert.ok(code.length < 80, `compact: ${code.length} chars`);
});

test('any single flipped bit is detected', () => {
  const bytes = fromBase64Url(encodeState(sample));
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) {
    const copy = bytes.slice();
    copy[i] ^= 1 << b;
    assert.equal(decodeState(toBase64Url(copy)).ok, false, `byte ${i} bit ${b}`);
  }
});

test('garbage, truncated and future-version links fail gracefully', () => {
  assert.equal(decodeState('!!!').ok, false);
  assert.equal(decodeState('').ok, false);
  const code = encodeState(sample);
  assert.equal(decodeState(code.slice(0, 20)).ok, false);
  const bytes = fromBase64Url(code);
  bytes[0] = 99;
  const body = bytes.subarray(0, bytes.length - 4);
  new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32(body));
  assert.match(decodeState(toBase64Url(bytes)).error, /version 99/);
});
