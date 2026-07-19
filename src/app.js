// UI wiring. All modelling lives in pure modules (pipeline, daylight, optimizer, care, ...); this file only
// reads controls, calls analyze(), and renders results.
import { VoxelRoom } from './voxel.js';
import { analyze, atTime, DEFAULT_STATE } from './pipeline.js';
import { dliToUnit, DLI_THRESHOLDS } from './daylight.js';
import { FURNITURE, GLAZING, WALLS, wallLength, wallFacing, compassLabel } from './floorplan.js';
import { CITY_PRESETS, MONTH_NAMES } from './solar.js';
import { toICS } from './care.js';
import { diagnose, SYMPTOMS } from './diagnose.js';
import { encodeState, decodeState } from './share.js';
import { ambientFromBrightness } from './engine.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#3b6fe0', '#45c06a', '#f2d33a', '#f2792a'];
const CLASS_NAMES = ['low', 'medium', 'bright', 'direct'];
const STORE = 'rpm-state-v2';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- state ----------
let state = structuredClone(DEFAULT_STATE);
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem('rpm-state') || '{}');
  Object.assign(state, saved);
} catch {}
const hash = new URLSearchParams(location.hash.slice(1));
let shareNote = '';
if (hash.has('s')) {
  const r = decodeState(hash.get('s'));
  if (r.ok) Object.assign(state, r.state); else shareNote = r.error;
}
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

const view = new VoxelRoom($('view'), { onPick: (pl) => select(pl) });
let result = null;

// ---------- editors ----------
function clampOpenings() {
  for (const o of [...state.windows, ...state.doors]) {
    const len = wallLength(state, o.wall);
    o.width = Math.max(1, Math.min(o.width, len));
    o.pos = Math.max(0, Math.min(o.pos, len - o.width));
  }
  for (const f of state.furniture) { f.x = Math.max(0, Math.min(f.x, state.w - f.w)); f.z = Math.max(0, Math.min(f.z, state.d - f.d)); }
}

const wallSelect = (cur) => `<select data-k="wall" title="wall (compass facing)">${WALLS.map((s) => { const f = compassLabel(wallFacing(state, s)); return `<option value="${s}" ${s === cur ? 'selected' : ''}>${f === s ? s : `${s} → ${f}`}</option>`; }).join('')}</select>`;

function renderWindowEditor() {
  clampOpenings();
  const root = $('windows');
  root.innerHTML = '';
  state.windows.forEach((w, i) => {
    const len = wallLength(state, w.wall);
    const el = document.createElement('div');
    el.className = 'opening';
    el.innerHTML = `<div class="win">${wallSelect(w.wall)}
        <input data-k="pos" type="range" min="0" max="${len - 1}" value="${w.pos}" title="position">
        <input data-k="width" type="range" min="1" max="${Math.min(8, len)}" value="${w.width}" title="width">
        <button type="button" data-k="rm" title="remove">×</button></div>
      <details><summary>Details</summary>
        <label>Sill <output>${(w.sill ?? 0.5).toFixed(1)} m</output><input data-k="sill" type="range" min="0" max="1.5" step="0.5" value="${w.sill ?? 0.5}"></label>
        <label>Head <output>${(w.head ?? 2).toFixed(1)} m</output><input data-k="head" type="range" min="1" max="2.5" step="0.5" value="${w.head ?? 2}"></label>
        <label>Overhang / balcony <output>${(w.overhang ?? 0).toFixed(1)} m</output><input data-k="overhang" type="range" min="0" max="2" step="0.1" value="${w.overhang ?? 0}"></label>
        <label>Building opposite <output>${w.obstruction ?? 0}°</output><input data-k="obstruction" type="range" min="0" max="60" step="5" value="${w.obstruction ?? 0}"></label>
        <label>Sheer curtain <output>${Math.round((w.curtain ?? 0) * 100)}%</output><input data-k="curtain" type="range" min="0" max="0.8" step="0.1" value="${w.curtain ?? 0}"></label>
        <label>Glass <select data-k="glazing">${Object.entries(GLAZING).map(([k, g]) => `<option value="${k}" ${k === (w.glazing ?? 'double') ? 'selected' : ''}>${g.label}</option>`).join('')}</select></label>
      </details>`;
    el.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      if (k === 'rm') inp.onclick = () => { state.windows.splice(i, 1); renderEditors(); persist(); };
      else inp.oninput = () => {
        w[k] = k === 'wall' || k === 'glazing' ? inp.value : +inp.value;
        if (k === 'head' && w.head <= (w.sill ?? 0.5)) w.sill = w.head - 0.5;
        if (k === 'wall') renderEditors(); else { clampOpenings(); const out = inp.parentElement.querySelector('output'); if (out) out.textContent = fmtDetail(k, w[k]); }
        persist();
      };
    });
    if (w._open) el.querySelector('details').open = true;
    el.querySelector('details').ontoggle = (e) => { w._open = e.target.open; };
    root.appendChild(el);
  });
}
const fmtDetail = (k, v) => (k === 'obstruction' ? `${v}°` : k === 'curtain' ? `${Math.round(v * 100)}%` : `${(+v).toFixed(1)} m`);

function renderDoorEditor() {
  const root = $('doors');
  root.innerHTML = '';
  state.doors.forEach((dr, i) => {
    const len = wallLength(state, dr.wall);
    const el = document.createElement('div');
    el.className = 'win';
    el.innerHTML = `${wallSelect(dr.wall)}<input data-k="pos" type="range" min="0" max="${len - 2}" value="${dr.pos}" title="position"><span class="hint">2 cells</span><button type="button" data-k="rm">×</button>`;
    el.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      if (k === 'rm') inp.onclick = () => { state.doors.splice(i, 1); renderEditors(); persist(); };
      else inp.oninput = () => { dr[k] = k === 'wall' ? inp.value : +inp.value; if (k === 'wall') renderEditors(); else clampOpenings(); persist(); };
    });
    root.appendChild(el);
  });
}

function renderFurnitureEditor() {
  const root = $('furniture');
  root.innerHTML = '';
  state.furniture.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'furn';
    el.innerHTML = `<span>${esc(FURNITURE[f.kind].label)}</span>
      <input data-k="x" type="range" min="0" max="${state.w - f.w}" value="${f.x}" title="east-west">
      <input data-k="z" type="range" min="0" max="${state.d - f.d}" value="${f.z}" title="north-south">
      <button type="button" data-k="rot" title="rotate">⟳</button><button type="button" data-k="rm" title="remove">×</button>`;
    el.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      if (k === 'rm') inp.onclick = () => { state.furniture.splice(i, 1); renderEditors(); persist(); };
      else if (k === 'rot') inp.onclick = () => { [f.w, f.d] = [f.d, f.w]; clampOpenings(); renderEditors(); persist(); };
      else inp.oninput = () => { f[k] = +inp.value; persist(); };
    });
    root.appendChild(el);
  });
}

function renderEditors() { renderWindowEditor(); renderDoorEditor(); renderFurnitureEditor(); }

// ---------- analysis & results ----------
function run() {
  clampOpenings();
  result = analyze(state);
  view.build(result.room, result.unitGrid, result.placements, result.plan.lamps.filter((l) => l.months.includes(state.month)));
  applyHeatMode();
  view.setLabels($('labels').checked);
  renderResults();
  updateClock();
}

function renderResults() {
  const r = result;
  $('errors').innerHTML = r.errors.map((e) => `<li>${esc(e)}</li>`).join('');
  const s = r.summary;
  $('lightBars').innerHTML = `<div class="bar">${s.fractions.map((f, i) => `<i style="width:${f * 100}%;background:${COLORS[i]}"></i>`).join('')}</div>
    <div class="legend">${CLASS_NAMES.map((c, i) => `<span><b style="background:${COLORS[i]}"></b>${c} ${Math.round(s.fractions[i] * 100)}%</span>`).join('')}</div>
    <p class="hint">${MONTH_NAMES[state.month]} floor average ${s.mean.toFixed(1)} mol/m²/day (low &lt; ${DLI_THRESHOLDS[0]}, bright ≥ ${DLI_THRESHOLDS[2]}). Simulated from sun position, window geometry, glazing, obstructions and furniture.</p>`;
  $('yearChart').innerHTML = yearChart(r.roomMeanByMonth, r.placements);
  $('plants').innerHTML = r.placements.length ? r.placements.map((p, i) => `
    <div class="card" data-i="${i}"><h3>${esc(p.plant.name)} <small>${esc(p.plant.sci)}</small></h3>
      <div class="tags"><span class="tag">${p.dli.toFixed(1)} mol/m²/d here</span><span class="tag">water ~every ${Math.round(p.interval)} d</span>
      <span class="tag">${p.pot.diameterCm} cm pot</span><span class="tag">${p.plant.petSafe ? 'pet-safe' : 'toxic to pets'}</span></div>
      ${sparkline(p.monthlyDli, p.plant.dli)}
      <p>${p.reasons.map(esc).join('; ')}.</p>
      <p>${esc(p.plant.tip)}${p.plant.toxin ? ` <em>Contains ${esc(p.plant.toxin)}.</em>` : ''}</p></div>`).join('')
    : '<p class="hint">No plant fits these settings well. Allow harder plants, add a window, or plan a grow lamp.</p>';
  document.querySelectorAll('.card').forEach((el) => (el.onclick = () => select(result.placements[+el.dataset.i])));
  $('searchNote').textContent = `Placement search: ${r.search.pool} candidate plants × ${r.search.cells} spots, ${r.search.iterations} annealing steps; score ${r.search.initial.toFixed(2)} → ${r.search.score.toFixed(2)}.`;
  $('lighting').innerHTML = r.advice.map((a) => `<li>${esc(a)}</li>`).join('');
  renderCalendar();
  renderDiagnosePlants();
}

/** Bar chart of the room's mean DLI per month, with the selected month highlighted. */
function yearChart(values, placements) {
  const W = 300, H = 90, pad = 18, bw = (W - pad) / 12;
  const max = Math.max(4, ...values, ...placements.map((p) => p.plant.dli[0]));
  const y = (v) => H - 14 - (v / max) * (H - 24);
  const bars = values.map((v, m) => `<rect x="${pad + m * bw + 2}" y="${y(v)}" width="${bw - 4}" height="${H - 14 - y(v)}" rx="2" fill="${m === state.month ? 'var(--accent)' : 'var(--line)'}"><title>${MONTH_NAMES[m]}: ${v.toFixed(1)} mol/m²/day</title></rect>
    <text x="${pad + m * bw + bw / 2}" y="${H - 2}" text-anchor="middle">${MONTH_NAMES[m][0]}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Room average daily light by month">${bars}
    <text x="0" y="${y(max) + 8}">${max.toFixed(0)}</text><text x="0" y="${H - 14}">0</text></svg>
    <p class="hint">Room average DLI by month. In summer the high sun lights less of the floor; in winter it reaches deeper.</p>`;
}

function sparkline(vals, [lo, hi]) {
  const W = 120, H = 22, max = Math.max(hi * 1.2, ...vals);
  const pts = vals.map((v, i) => `${(i / 11) * W},${H - (v / max) * H}`).join(' ');
  const band = `<rect x="0" y="${H - (hi / max) * H}" width="${W}" height="${((hi - lo) / max) * H}" fill="var(--accent)" opacity=".15"/>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-label="Light at this spot by month against the plant's range">${band}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}

function renderCalendar() {
  const sched = result.schedule;
  $('chores').innerHTML = 'Water on: ' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => `<label class="chip"><input type="checkbox" data-d="${i}" ${state.choreDays.includes(i) ? 'checked' : ''}>${d}</label>`).join('')
    + '<span class="hint"> (none = whenever each pot needs it)</span>';
  $('chores').querySelectorAll('input').forEach((c) => (c.onchange = () => {
    const d = +c.dataset.d;
    state.choreDays = c.checked ? [...state.choreDays, d].sort() : state.choreDays.filter((x) => x !== d);
    persist(); run();
  }));
  const start = new Date(sched.start + 'T00:00:00Z');
  const lead = (start.getUTCDay() + 6) % 7; // Monday-first grid
  const byDate = new Map(sched.days.map((d) => [d.date, d]));
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push('<div class="pad"></div>');
  for (let i = 0; i < 28; i++) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const e = byDate.get(date);
    const names = e ? [...e.water.map((w) => w.plant), ...e.feed.map((f) => `🌱 ${f.plant}`)] : [];
    cells.push(`<div title="${esc(names.join(', '))}"><b>${+date.slice(8)}</b>${names.slice(0, 2).map((n) => `<span>${esc(n)}</span>`).join('')}${names.length > 2 ? `<span>+${names.length - 2}</span>` : ''}</div>`);
  }
  $('calendar').innerHTML = `<div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`;
}

$('ics').onclick = () => {
  const blob = new Blob([toICS(result.schedule, { name: 'Plant care' })], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'plant-care.ics' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- diagnosis ----------
$('symptoms').innerHTML = Object.entries(SYMPTOMS).map(([k, label]) => `<label class="row"><input type="checkbox" value="${k}"> ${esc(label)}</label>`).join('');
function renderDiagnosePlants() {
  const cur = $('dxPlant').value;
  $('dxPlant').innerHTML = result.placements.map((p, i) => `<option value="${i}">${esc(p.plant.name)}</option>`).join('');
  if (cur && +cur < result.placements.length) $('dxPlant').value = cur;
}
$('dxRun').onclick = () => {
  const pl = result.placements[+$('dxPlant').value];
  const present = [...$('symptoms').querySelectorAll('input:checked')].map((c) => c.value);
  if (!present.length) { $('dxOut').innerHTML = '<li>Tick at least one symptom.</li>'; return; }
  const m = state.month;
  const ctx = pl ? { plant: pl.plant, dli: pl.monthlyDli[m], rh: result.climate.rh[m], tempC: result.climate.temp[m], modelInterval: pl.interval, wateringDays: +$('dxWater').value || undefined } : {};
  const ranked = diagnose(present, ctx).slice(0, 3);
  $('dxOut').innerHTML = ranked.map((r) => `<li><b>${esc(r.label)}</b> <span class="pct">${Math.round(r.probability * 100)}%</span>
    ${r.evidence.length ? `<div class="hint">Because: ${r.evidence.map(esc).join('; ')}.</div>` : ''}<div>${esc(r.fix)}</div></li>`).join('');
};

// ---------- share ----------
$('share').onclick = async () => {
  const code = encodeState(state);
  const url = `${location.origin}${location.pathname}#s=${code}`;
  history.replaceState(null, '', `#s=${code}`);
  try { await navigator.clipboard.writeText(url); $('shareOut').textContent = 'Link copied.'; } catch { $('shareOut').textContent = url; }
};
if (shareNote) $('shareOut').textContent = `Could not open the shared room: ${shareNote}`;

// ---------- selection, time, heat ----------
function select(pl) {
  document.querySelectorAll('.card').forEach((el) => el.classList.toggle('active', result.placements[+el.dataset.i] === pl));
  const el = document.querySelector('.card.active');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  view.focus(pl);
}

function applyHeatMode() {
  const mode = $('heatMode').value;
  view.setHeatmap(mode !== 'off');
  if (mode === 'month') view.updateHeat(result.unitGrid);
  if (mode === 'now') updateClock();
}

function updateClock() {
  if (!result) return;
  const t = +$('time').value;
  const snap = atTime(result, t);
  view.setSun(snap.sun.vec, snap.sun.elevation);
  if ($('heatMode').value === 'now') {
    // PPFD → a 0..1 scale comparable to the daily map: 12 h at this PPFD would give this DLI.
    view.updateHeat(snap.ppfd.map((col) => col.map((v) => dliToUnit((v * 12 * 3600) / 1e6))));
  }
  const h = Math.floor(snap.hour), mi = Math.round((snap.hour - h) * 60);
  $('clock').textContent = `${String(h).padStart(2, '0')}:${String(mi % 60).padStart(2, '0')} solar · sun ${compassLabel(snap.sun.azimuth)} ${Math.max(0, snap.sun.elevation).toFixed(0)}°`;
}

// ---------- controls ----------
function bindRange(id, key, out, fmt = (v) => v, after = () => {}) {
  const el = $(id);
  el.value = state[key];
  $(out).textContent = fmt(state[key]);
  el.oninput = () => { state[key] = +el.value; $(out).textContent = fmt(state[key]); after(); persist(); };
}
$('city').innerHTML = '<option value="">Custom</option>' + CITY_PRESETS.map((c) => `<option value="${c.lat}">${esc(c.name)}</option>`).join('');
$('city').value = CITY_PRESETS.some((c) => c.lat === state.lat) ? String(state.lat) : '';
$('city').onchange = () => { if ($('city').value) { state.lat = +$('city').value; $('lat').value = state.lat; $('latOut').textContent = fmtLat(state.lat); persist(); } };
const fmtLat = (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`;
bindRange('lat', 'lat', 'latOut', fmtLat, () => { $('city').value = ''; });
bindRange('rotation', 'rotation', 'rotOut', (v) => `N wall faces ${compassLabel(v)} (${v}°)`, renderEditors);
$('month').innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
$('month').value = state.month;
$('month').onchange = () => { state.month = +$('month').value; persist(); run(); };
$('cloud').value = String(state.cloud);
$('cloud').onchange = () => { state.cloud = +$('cloud').value; persist(); };
bindRange('w', 'w', 'wOut', (v) => `${v / 2} m`, renderEditors);
bindRange('d', 'd', 'dOut', (v) => `${v / 2} m`, renderEditors);
bindRange('n', 'n', 'nOut');
$('pets').checked = state.pets;
$('pets').onchange = () => { state.pets = $('pets').checked; persist(); };
$('edible').checked = state.edibleOnly;
$('edible').onchange = () => { state.edibleOnly = $('edible').checked; persist(); };
$('exp').value = state.exp;
$('exp').onchange = () => { state.exp = +$('exp').value; persist(); };
$('addWindow').onclick = () => { state.windows.push({ wall: 'S', pos: 0, width: 3 }); renderEditors(); persist(); };
$('addDoor').onclick = () => { state.doors.push({ wall: 'W', pos: 0, width: 2 }); renderEditors(); persist(); };
$('furnKind').innerHTML = Object.entries(FURNITURE).map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join('');
$('addFurn').onclick = () => {
  const k = $('furnKind').value, f = FURNITURE[k];
  state.furniture.push({ kind: k, x: Math.floor((state.w - f.w) / 2), z: Math.floor((state.d - f.d) / 2), w: f.w, d: f.d });
  renderEditors(); persist();
};

$('photo').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 48, 48);
    const px = g.getImageData(0, 0, 48, 48).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const b = sum / (px.length / 4);
    state.ambient = ambientFromBrightness(b);
    $('photoHint').textContent = `Average brightness ${(b * 100).toFixed(0)}% → simulated light ×${state.ambient.toFixed(2)}. Rough: a photo's exposure is set by the camera.`;
    URL.revokeObjectURL(img.src);
    persist();
  };
  img.src = URL.createObjectURL(f);
};

$('scan').onclick = () => {
  $('scan').disabled = true;
  $('scan').textContent = 'Scanning…';
  // Let the button repaint before the (fast, but synchronous) simulation runs.
  requestAnimationFrame(() => setTimeout(() => {
    run();
    view.startScan(() => { $('scan').disabled = false; $('scan').textContent = 'Scan room'; });
  }));
};
$('heatMode').onchange = applyHeatMode;
$('labels').onchange = () => view.setLabels($('labels').checked);
$('time').oninput = updateClock;

const q = new URLSearchParams(location.search); // ?t=0.2&heat=month for shareable views
if (q.has('t')) $('time').value = q.get('t');
if (q.has('heat')) $('heatMode').value = q.get('heat') === '1' ? 'month' : q.get('heat');
renderEditors();
run();
view.startScan();
