// Procedural voxel plants. One sub-voxel = 1/4 of a floor cell. Coordinates: x,z centred on the cell, y up from the floor.
// Returns [{x, y, z, c}] with c as a 0xRRGGBB colour. Deterministic for a given seed.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

const RING = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function pot(v, r, color = 0xb5651d) {
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      const rim = x !== 0 || z !== 0;
      v.push({ x, y: 0, z, c: shade(color, 0.85 + r() * 0.1) });
      v.push({ x, y: 1, z, c: rim ? shade(color, 1.1) : 0x3b2a1e });
    }
}

const kinds = {
  column(v, m, r) { // cactus
    for (let y = 2; y < 2 + m.h; y++) {
      v.push({ x: 0, y, z: 0, c: shade(m.color, 0.9 + r() * 0.2) });
      if (y % 2 === 0) v.push({ x: 1, y, z: 0, c: shade(m.color, 0.7) }); // ribs
    }
    for (let y = 4; y < 4 + 2; y++) v.push({ x: -1, y: y, z: 0, c: m.color });
    v.push({ x: -1, y: 3, z: 0, c: m.color });
    v.push({ x: 0, y: 2 + m.h, z: 0, c: m.accent }); // flower
  },
  blades(v, m, r) { // snake plant, spider plant, peace lily...
    const spots = [[0, 0], ...RING];
    spots.forEach(([x, z], i) => {
      const h = Math.max(3, m.h - 1 - Math.floor(r() * 3) - (i > 4 ? 2 : 0));
      for (let y = 2; y < 2 + h; y++) {
        const edge = y >= 2 + h - 1;
        v.push({ x: x + (y > 2 + h / 2 && x !== 0 ? Math.sign(x) * 0 : 0), y, z, c: edge && m.accent !== m.color ? m.accent : shade(m.color, 0.85 + r() * 0.3) });
      }
      if (m.flower && i < 2) v.push({ x, y: 2 + h, z, c: 0xffffff });
    });
  },
  rosette(v, m, r) { // aloe, succulents
    for (let y = 2; y < 2 + Math.max(2, m.h - 2); y++) v.push({ x: 0, y, z: 0, c: shade(m.color, 1.05) });
    RING.forEach(([x, z], i) => {
      v.push({ x, y: 2, z, c: shade(m.color, 0.9 + r() * 0.2) });
      v.push({ x, y: 3, z, c: shade(m.color, 1 + r() * 0.2) });
      if (i < 4) v.push({ x: x * 2, y: 3, z: z * 2, c: m.accent });
      if (m.h > 4 && i < 4) v.push({ x, y: 4, z, c: shade(m.color, 1.1) });
    });
  },
  bush(v, m, r) { // ferns, palms, herbs
    const h = m.h;
    for (let y = 2; y < 2 + h; y++) {
      const t = (y - 2) / h;
      const rad = Math.sin(Math.min(1, t * 1.4 + 0.2) * Math.PI) * 2.2 + 0.4;
      for (let x = -2; x <= 2; x++)
        for (let z = -2; z <= 2; z++)
          if (x * x + z * z <= rad * rad && r() < 0.72) v.push({ x, y, z, c: shade(r() < 0.3 ? m.accent : m.color, 0.8 + r() * 0.4) });
    }
  },
  broad(v, m, r) { // monstera, rubber plant, fiddle leaf: trunk with leaf plates
    const top = m.h;
    for (let y = 2; y < 2 + top - 1; y++) v.push({ x: 0, y, z: 0, c: 0x6b4a2b });
    const n = 5 + Math.floor(top / 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const y = 4 + Math.floor((i / n) * (top - 3));
      const dx = Math.round(Math.cos(a) * 2), dz = Math.round(Math.sin(a) * 2);
      const c = i % 3 === 0 ? m.accent : m.color;
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) v.push({ x: Math.max(-2, Math.min(2, dx + ox - 0)), y, z: Math.max(-2, Math.min(2, dz + oz)), c: shade(c, 0.85 + r() * 0.3) });
      v.push({ x: Math.round(dx / 2), y: y - 1, z: Math.round(dz / 2), c: 0x6b4a2b }); // petiole
    }
    v.push({ x: 0, y: 2 + top - 1, z: 0, c: m.accent });
    v.push({ x: 0, y: 2 + top, z: 0, c: shade(m.color, 1.1) });
  },
  vine(v, m, r) { // pothos: bushy top, trailing down the pot
    for (let y = 2; y < 2 + m.h; y++)
      for (const [x, z] of [[0, 0], ...RING.slice(0, 4)]) if (y < 4 || r() < 0.6) v.push({ x, y, z, c: shade(r() < 0.3 ? m.accent : m.color, 0.85 + r() * 0.3) });
    for (const [x, z] of [[-2, 0], [2, 0], [0, 2], [0, -2], [-2, 2], [2, -2]]) {
      const len = 3 + Math.floor(r() * 4);
      for (let y = 3; y >= 3 - len && y >= -1; y--) v.push({ x, y: y + 1, z, c: shade(r() < 0.35 ? m.accent : m.color, 0.8 + r() * 0.3) });
    }
  },
  tree(v, m, r) { // jade, dracaena, ponytail palm, pilea: a trunk with a canopy on top
    const trunk = Math.max(2, Math.floor(m.h * 0.55));
    for (let y = 2; y < 2 + trunk; y++) v.push({ x: 0, y, z: 0, c: shade(m.accent === m.color ? 0x6b4a2b : 0x6b4a2b, 0.9 + r() * 0.2) });
    const top = 2 + trunk;
    for (let y = top; y < 2 + m.h; y++) {
      const rad = y === top || y === 1 + m.h ? 1.2 : 2.1;
      for (let x = -2; x <= 2; x++)
        for (let z = -2; z <= 2; z++)
          if (x * x + z * z <= rad * rad && r() < 0.8) v.push({ x, y, z, c: shade(r() < 0.25 ? m.accent : m.color, 0.85 + r() * 0.3) });
    }
  },
  pearls(v, m, r) { // string of pearls: a low mound and beaded strands spilling over the rim
    for (const [x, z] of [[0, 0], ...RING]) for (let y = 2; y < 2 + m.h; y++) if (r() < 0.7) v.push({ x, y, z, c: shade(m.color, 0.85 + r() * 0.3) });
    for (const [x, z] of [[-2, 0], [2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [-2, 2], [2, -2]]) {
      const len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) if (k % 2 === 0 || r() < 0.5) v.push({ x, y: 2 - k, z, c: shade(k % 2 ? m.accent : m.color, 0.9 + r() * 0.2) });
    }
  },
  orchid(v, m, r) { // orchid, African violet: low leaves with flowers held above
    RING.forEach(([x, z]) => { v.push({ x, y: 2, z, c: shade(m.color, 0.9 + r() * 0.2) }); if (r() < 0.6) v.push({ x: x * 2, y: 2, z: z * 2, c: shade(m.color, 0.8) }); });
    v.push({ x: 0, y: 2, z: 0, c: m.color });
    const stem = Math.max(1, m.h - 2);
    for (let y = 3; y < 3 + stem; y++) v.push({ x: 0, y, z: y > 4 ? 1 : 0, c: 0x4a6a3a });
    for (const [x, z] of [[0, 1], [1, 1], [-1, 1], [0, 2], [0, 0]]) v.push({ x, y: 3 + stem - (x === 0 && z === 0 ? 1 : 0), z, c: shade(m.accent, 0.9 + r() * 0.2) });
  },
};

export function buildPlantVoxels(plant, seed = 1) {
  const r = rng(seed);
  const v = [];
  pot(v, r, plant.model.potColor);
  (kinds[plant.model.kind] || kinds.bush)(v, plant.model, r);
  // de-duplicate (later voxels win)
  const map = new Map();
  for (const p of v) map.set(`${p.x},${p.y},${p.z}`, p);
  return [...map.values()];
}
