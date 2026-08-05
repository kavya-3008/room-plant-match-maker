// Room geometry: walls, window details, doors, furniture and which floor cells can hold a plant.
// Grid cells are CELL_M metres. Room frame: +x east, +z south, +y up; the north wall is z = 0.
// `room.rotation` turns the whole room clockwise (degrees), so its "N" wall can face any compass direction.

export const CELL_M = 0.5;
export const WALL_H_M = 2.5;
export const WALLS = ['N', 'E', 'S', 'W'];
const BASE_AZ = { N: 0, E: 90, S: 180, W: 270 };
export const NORMALS = { N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 }, E: { x: 1, z: 0 } };

/** PAR transmittance at normal incidence (approximate; manufacturers quote visible transmittance, which is close). */
export const GLAZING = {
  single: { label: 'Single pane', tau: 0.85 },
  double: { label: 'Double pane', tau: 0.75 },
  lowE: { label: 'Low-E double', tau: 0.62 },
  tinted: { label: 'Tinted', tau: 0.45 },
};

export const WINDOW_DEFAULTS = Object.freeze({ sill: 0.5, head: 2.0, overhang: 0, obstruction: 0, glazing: 'double', curtain: 0 });

/** Footprints in cells, heights in metres. `blocksLight` false means it is low enough to ignore for shadows. */
export const FURNITURE = {
  sofa: { label: 'Sofa', w: 4, d: 2, h: 0.85, color: 0x5a6b8c },
  bed: { label: 'Bed', w: 4, d: 4, h: 0.6, color: 0xd8d0c0 },
  desk: { label: 'Desk', w: 3, d: 2, h: 0.75, color: 0x8a5a34 },
  table: { label: 'Dining table', w: 3, d: 3, h: 0.75, color: 0x9a6a3c },
  bookshelf: { label: 'Bookshelf', w: 2, d: 1, h: 2.0, color: 0x6e4a2a },
  wardrobe: { label: 'Wardrobe', w: 3, d: 2, h: 2.1, color: 0x7d5532 },
  tvstand: { label: 'TV stand', w: 3, d: 1, h: 0.55, color: 0x2f2f33 },
  armchair: { label: 'Armchair', w: 2, d: 2, h: 0.9, color: 0x8c5a5a },
};

export const key = (x, z) => `${x},${z}`;
const mod360 = (a) => ((a % 360) + 360) % 360;

export function wallLength(room, wall) {
  return wall === 'N' || wall === 'S' ? room.w : room.d;
}

/** Compass azimuth that a wall's outward normal faces, after room rotation. */
export function wallFacing(room, wall) {
  return mod360(BASE_AZ[wall] + (room.rotation || 0));
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassLabel(az) {
  return COMPASS[Math.round(mod360(az) / 45) % 8];
}

/** Fill in window defaults, clamp to the wall and drop missing optional arrays. Returns a new object. */
export function normalizeRoom(room) {
  const out = {
    w: room.w, d: room.d, rotation: room.rotation || 0,
    windows: (room.windows || []).map((win) => {
      const v = { ...WINDOW_DEFAULTS, ...win };
      const len = wallLength(room, v.wall);
      v.width = Math.max(1, Math.min(v.width, len));
      v.pos = Math.max(0, Math.min(v.pos, len - v.width));
      v.sill = Math.max(0, Math.min(v.sill, WALL_H_M - 0.25));
      v.head = Math.max(v.sill + 0.25, Math.min(v.head, WALL_H_M));
      return v;
    }),
    doors: (room.doors || []).map((dr) => ({ width: 2, ...dr })),
    furniture: (room.furniture || []).map((f) => ({ ...FURNITURE[f.kind], ...f })),
  };
  return out;
}

/** The window opening in metres: an axis-aligned rectangle on its wall plane. */
export function windowRect(room, win) {
  const W = room.w * CELL_M, D = room.d * CELL_M;
  const a0 = win.pos * CELL_M, a1 = (win.pos + win.width) * CELL_M;
  const n = NORMALS[win.wall];
  // plane: the coordinate along the normal axis; along: the other horizontal axis
  if (win.wall === 'N') return { axis: 'z', plane: 0, alongAxis: 'x', a0, a1, y0: win.sill, y1: win.head, n };
  if (win.wall === 'S') return { axis: 'z', plane: D, alongAxis: 'x', a0, a1, y0: win.sill, y1: win.head, n };
  if (win.wall === 'W') return { axis: 'x', plane: 0, alongAxis: 'z', a0, a1, y0: win.sill, y1: win.head, n };
  return { axis: 'x', plane: W, alongAxis: 'z', a0, a1, y0: win.sill, y1: win.head, n };
}

/** Furniture as axis-aligned boxes in metres, for ray tests. */
export function furnitureBoxes(room) {
  return (room.furniture || []).map((f) => ({
    x0: f.x * CELL_M, x1: (f.x + f.w) * CELL_M, z0: f.z * CELL_M, z1: (f.z + f.d) * CELL_M, y0: 0, y1: f.h, kind: f.kind,
  }));
}

export function occupiedCells(room) {
  const s = new Set();
  for (const f of room.furniture || []) for (let x = f.x; x < f.x + f.w; x++) for (let z = f.z; z < f.z + f.d; z++) s.add(key(x, z));
  return s;
}

/** Cells that must stay clear so a door can swing and people can walk through. */
export function doorClearance(room, depth = 2) {
  const s = new Set();
  for (const dr of room.doors || []) {
    for (let a = dr.pos - 1; a < dr.pos + dr.width + 1; a++) {
      for (let k = 0; k < depth; k++) {
        let x, z;
        if (dr.wall === 'N') { x = a; z = k; } else if (dr.wall === 'S') { x = a; z = room.d - 1 - k; } else if (dr.wall === 'W') { x = k; z = a; } else { x = room.w - 1 - k; z = a; }
        if (x >= 0 && z >= 0 && x < room.w && z < room.d) s.add(key(x, z));
      }
    }
  }
  return s;
}

/** Distance in cells from cell (x, z) to the nearest wall. */
export function wallDistance(room, x, z) {
  return Math.min(x, z, room.w - 1 - x, room.d - 1 - z);
}

/**
 * Floor cells where a plant can stand: within `band` cells of a wall, or right next to furniture,
 * not under furniture and not in a door's clearance zone.
 */
export function plantableCells(room, { band = 1, besideFurniture = true } = {}) {
  const occ = occupiedCells(room), door = doorClearance(room);
  const near = new Set();
  if (besideFurniture) for (const c of occ) {
    const [x, z] = c.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) near.add(key(x + dx, z + dz));
  }
  const out = [];
  for (let x = 0; x < room.w; x++) for (let z = 0; z < room.d; z++) {
    const k = key(x, z);
    if (occ.has(k) || door.has(k)) continue;
    if (wallDistance(room, x, z) <= band || near.has(k)) out.push({ x, z });
  }
  return out;
}

/** Human-readable problems with a room description. Empty array means valid. */
export function validateRoom(room) {
  const errs = [];
  if (!(room.w >= 2 && room.d >= 2)) errs.push('Room must be at least 2 x 2 cells.');
  const openings = [...(room.windows || []).map((o) => ({ ...o, t: 'window' })), ...(room.doors || []).map((o) => ({ ...o, t: 'door' }))];
  for (const o of openings) {
    const len = wallLength(room, o.wall);
    if (!WALLS.includes(o.wall)) errs.push(`Unknown wall "${o.wall}".`);
    else if (o.pos < 0 || o.pos + o.width > len) errs.push(`A ${o.t} on the ${o.wall} wall runs past the wall's end.`);
    if (o.t === 'window' && o.head != null && o.sill != null && o.head <= o.sill) errs.push(`A window on the ${o.wall} wall has its head below its sill.`);
  }
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i], b = openings[j];
    if (a.wall === b.wall && a.pos < b.pos + b.width && b.pos < a.pos + a.width) {
      const vertical = a.t === 'window' && b.t === 'window' && ((a.head ?? 2) <= (b.sill ?? 0.5) || (b.head ?? 2) <= (a.sill ?? 0.5));
      if (!vertical) errs.push(`A ${a.t} and a ${b.t} overlap on the ${a.wall} wall.`);
    }
  }
  const furn = room.furniture || [];
  furn.forEach((f, i) => {
    if (f.x < 0 || f.z < 0 || f.x + f.w > room.w || f.z + f.d > room.d) errs.push(`${f.label || f.kind} #${i + 1} sticks out of the room.`);
    for (let j = i + 1; j < furn.length; j++) {
      const g = furn[j];
      if (f.x < g.x + g.w && g.x < f.x + f.w && f.z < g.z + g.d && g.z < f.z + f.d) errs.push(`${f.label || f.kind} and ${g.label || g.kind} overlap.`);
    }
  });
  const door = doorClearance(room), occ = occupiedCells(room);
  if ([...occ].some((c) => door.has(c))) errs.push('Furniture blocks a doorway.');
  return errs;
}
