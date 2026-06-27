// Shareable links: the whole room setup packed into a compact binary record, base64url-encoded for the
// URL hash. A version byte allows the format to evolve; a CRC-32 rejects truncated or mangled links.
//
// Layout (all integers big-endian):
//   u8 version | u8 w | u8 d | u16 rotation° | i16 lat×100 | u8 month | u8 cloud×100 | u8 flags | u8 exp | u8 maxPlants
//   u8 nWindows × { u8 wall|glazing<<2 | u8 pos | u8 width | u8 sill/2cm | u8 head/2cm | u8 overhang/2cm | u8 obstruction° | u8 curtain×100 }
//   u8 nDoors × { u8 wall | u8 pos | u8 width }
//   u8 nFurniture × { u8 kind | u8 x | u8 z | u8 w | u8 d }
//   u8 choreMask (bit per weekday)
//   u32 CRC-32 of everything before it

import { WALLS, GLAZING, FURNITURE } from './floorplan.js';

export const FORMAT_VERSION = 2;
const GLAZE_KEYS = Object.keys(GLAZING);
const FURN_KEYS = Object.keys(FURNITURE);

let CRC_TABLE;
/** CRC-32 (IEEE 802.3, the zlib/PNG polynomial). */
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Pack app state into a URL-safe string. */
export function encodeState(s) {
  const out = [];
  const push8 = (v) => out.push(u8(v));
  const push16 = (v) => { const x = Math.round(v) & 0xffff; out.push(x >> 8, x & 0xff); };
  push8(FORMAT_VERSION); push8(s.w); push8(s.d);
  push16(((s.rotation || 0) % 360 + 360) % 360);
  push16(Math.round((s.lat ?? 35) * 100));
  push8(s.month ?? 0); push8((s.cloud ?? 0.4) * 100);
  push8((s.pets ? 1 : 0) | (s.edibleOnly ? 2 : 0));
  push8(s.exp ?? 3); push8(s.n ?? 6);
  const wins = s.windows || [];
  push8(wins.length);
  for (const w of wins) {
    push8(WALLS.indexOf(w.wall) | (Math.max(0, GLAZE_KEYS.indexOf(w.glazing ?? 'double')) << 2));
    push8(w.pos); push8(w.width);
    push8(((w.sill ?? 0.5) * 100) / 2); push8(((w.head ?? 2) * 100) / 2); push8(((w.overhang ?? 0) * 100) / 2);
    push8(w.obstruction ?? 0); push8((w.curtain ?? 0) * 100);
  }
  const doors = s.doors || [];
  push8(doors.length);
  for (const d of doors) { push8(WALLS.indexOf(d.wall)); push8(d.pos); push8(d.width ?? 2); }
  const furn = s.furniture || [];
  push8(furn.length);
  for (const f of furn) { push8(FURN_KEYS.indexOf(f.kind)); push8(f.x); push8(f.z); push8(f.w); push8(f.d); }
  push8((s.choreDays || []).reduce((m, d) => m | (1 << d), 0));
  const body = Uint8Array.from(out);
  const crc = crc32(body);
  const full = new Uint8Array(body.length + 4);
  full.set(body);
  new DataView(full.buffer).setUint32(body.length, crc);
  return toBase64Url(full);
}

/**
 * Unpack a share string. Never throws.
 * @returns {{ ok: true, state: object } | { ok: false, error: string }}
 */
export function decodeState(str) {
  let bytes;
  try { bytes = fromBase64Url(str); } catch { return { ok: false, error: 'Not a valid link.' }; }
  if (bytes.length < 18) return { ok: false, error: 'Link is too short.' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crc = dv.getUint32(bytes.length - 4);
  if (crc32(bytes.subarray(0, bytes.length - 4)) !== crc) return { ok: false, error: 'Link is damaged (checksum mismatch).' };
  let i = 0;
  const end = bytes.length - 4;
  const r8 = () => { if (i >= end) throw new Error('short'); return bytes[i++]; };
  const r16 = () => (r8() << 8) | r8();
  const ri16 = () => { const v = r16(); return v & 0x8000 ? v - 0x10000 : v; };
  try {
    const version = r8();
    if (version !== FORMAT_VERSION) return { ok: false, error: `Unsupported link version ${version}.` };
    const s = { w: r8(), d: r8(), rotation: r16(), lat: ri16() / 100, month: r8(), cloud: r8() / 100 };
    const flags = r8();
    Object.assign(s, { pets: !!(flags & 1), edibleOnly: !!(flags & 2), exp: r8(), n: r8() });
    s.windows = Array.from({ length: r8() }, () => {
      const wg = r8();
      return {
        wall: WALLS[wg & 3], glazing: GLAZE_KEYS[(wg >> 2) & 3], pos: r8(), width: r8(),
        sill: (r8() * 2) / 100, head: (r8() * 2) / 100, overhang: (r8() * 2) / 100, obstruction: r8(), curtain: r8() / 100,
      };
    });
    s.doors = Array.from({ length: r8() }, () => ({ wall: WALLS[r8() & 3], pos: r8(), width: r8() }));
    s.furniture = Array.from({ length: r8() }, () => ({ kind: FURN_KEYS[r8()], x: r8(), z: r8(), w: r8(), d: r8() }));
    const mask = r8();
    s.choreDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
    if (i !== end) return { ok: false, error: 'Link has trailing data.' };
    if (s.furniture.some((f) => !f.kind)) return { ok: false, error: 'Link names unknown furniture.' };
    return { ok: true, state: s };
  } catch {
    return { ok: false, error: 'Link is truncated.' };
  }
}
