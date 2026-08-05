// Minecraft-style 3D room. 1 world unit = 1 floor cell. +x east, +z south, +y up. Floor top surface is y = 0.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPlantVoxels } from './plantModels.js';

const SUB = 0.25;       // plant sub-voxel size
const WALL_H = 5;
const ROW_M = 0.5;      // one wall row is one grid cell tall (0.5 m)
const DOOR_ROWS = 4;    // doors are 2 m tall
const HEAT_COLORS = [0x3b6fe0, 0x45c06a, 0xf2d33a, 0xf2792a];

function pixelTexture(draw, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(ctx, size, base, amt, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) {
      const f = 1 + (r() - 0.5) * amt;
      ctx.fillStyle = `rgb(${Math.min(255, base[0] * f)},${Math.min(255, base[1] * f)},${Math.min(255, base[2] * f)})`;
      ctx.fillRect(x, y, 1, 1);
    }
}
const textures = () => ({
  planks: pixelTexture((c, n) => {
    noise(c, n, [176, 128, 80], 0.18, 3);
    c.fillStyle = 'rgba(60,35,15,.55)';
    for (let y = 0; y < n; y += 4) c.fillRect(0, y, n, 1);
    for (let y = 0; y < n; y += 4) c.fillRect(((y / 4) * 7) % n, y, 1, 4);
  }),
  brick: pixelTexture((c, n) => {
    noise(c, n, [196, 120, 96], 0.22, 5);
    c.fillStyle = 'rgba(225,205,190,.9)';
    for (let y = 0; y < n; y += 4) c.fillRect(0, y, n, 1);
    for (let y = 0; y < n; y += 4) c.fillRect((((y / 4) % 2) * 8) % n, y, 1, 4);
  }),
  grassTop: pixelTexture((c, n) => noise(c, n, [96, 168, 64], 0.35, 9)),
  grassSide: pixelTexture((c, n) => { noise(c, n, [122, 84, 52], 0.3, 11); c.fillStyle = '#60a840'; c.fillRect(0, 0, n, 4); }),
  dirt: pixelTexture((c, n) => noise(c, n, [122, 84, 52], 0.3, 13)),
});

export class VoxelRoom {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick;
    this.tex = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfe3ff, 40, 90);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.05;

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a60, 0.7);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.walls = [];      // {side, mesh, panes}
    this.labels = [];     // {el, pos}
    this.pickables = [];
    this.timeOfDay = 0.5;
    this.scan = null;
    this.clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
      const hit = ray.intersectObjects(this.pickables, false)[0];
      if (hit && this.onPick) this.onPick(hit.object.userData.placement);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  clear() {
    this.world.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.world.clear();
    this.walls = []; this.pickables = [];
    this.labelLayer.innerHTML = ''; this.labels = [];
  }

  /** Build the whole scene for a room, its light grid, plant placements and grow lamps. */
  build(room, grid, placements, lamps) {
    this.tex = this.tex || textures();
    this.clear();
    this.room = room;
    const { w, d } = room;
    const T = this.tex;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4();

    // Floor planks
    const floorMat = new THREE.MeshStandardMaterial({ map: T.planks, roughness: 0.9 });
    const floor = new THREE.InstancedMesh(box, floorMat, w * d);
    let i = 0;
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) floor.setMatrixAt(i++, m4.makeTranslation(x + 0.5, -0.5, z + 0.5));
    floor.receiveShadow = true;
    this.world.add(floor);

    // Grass ground ring around the house
    const R = 9;
    const gm = [T.grassSide, T.grassSide, T.grassTop, T.dirt, T.grassSide, T.grassSide].map((map) => new THREE.MeshStandardMaterial({ map, roughness: 1 }));
    const gpos = [];
    for (let x = -R; x < w + R; x++) for (let z = -R; z < d + R; z++) if (x < 0 || x >= w || z < 0 || z >= d) gpos.push([x, z]);
    const ground = new THREE.InstancedMesh(box, gm, gpos.length);
    gpos.forEach(([x, z], k) => ground.setMatrixAt(k, m4.makeTranslation(x + 0.5, -0.5, z + 0.5)));
    ground.receiveShadow = true;
    this.world.add(ground);

    // Walls, one instanced mesh per side so the camera-facing ones can fade out
    const sides = {
      N: { cells: [], gap: (c, row) => windowAt(room, 'N', c.x, row) },
      S: { cells: [], gap: (c, row) => windowAt(room, 'S', c.x, row) },
      W: { cells: [], gap: (c, row) => windowAt(room, 'W', c.z, row) },
      E: { cells: [], gap: (c, row) => windowAt(room, 'E', c.z, row) },
    };
    for (let x = -1; x <= w; x++) { sides.N.cells.push({ x, z: -1 }); sides.S.cells.push({ x, z: d }); }
    for (let z = 0; z < d; z++) { sides.W.cells.push({ x: -1, z }); sides.E.cells.push({ x: w, z }); }
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, roughness: 0.1 });
    const doorMat = new THREE.MeshStandardMaterial({ map: T.planks, color: 0x8a6a4a, roughness: 0.9 });
    for (const [side, def] of Object.entries(sides)) {
      const mat = new THREE.MeshStandardMaterial({ map: T.brick, roughness: 0.95 });
      const blocks = [], panes = [], doors = [];
      for (const c of def.cells) for (let row = 0; row < WALL_H; row++) {
        const gap = def.gap(c, row);
        const m = m4.clone().makeTranslation(c.x + 0.5, row + 0.5, c.z + 0.5);
        (gap === 'window' ? panes : gap === 'door' ? doors : blocks).push(m);
      }
      const thin = new THREE.Vector3(...(side === 'N' || side === 'S' ? [1, 1, 0.12] : [0.12, 1, 1]));
      const mesh = new THREE.InstancedMesh(box, mat, blocks.length);
      blocks.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = mesh.receiveShadow = true;
      const paneMesh = new THREE.InstancedMesh(box, glassMat, Math.max(1, panes.length));
      paneMesh.count = panes.length;
      panes.forEach((m, k) => paneMesh.setMatrixAt(k, m.clone().scale(thin)));
      const doorMesh = new THREE.InstancedMesh(box, doorMat, Math.max(1, doors.length));
      doorMesh.count = doors.length;
      doors.forEach((m, k) => doorMesh.setMatrixAt(k, m.clone().scale(thin)));
      doorMesh.castShadow = true;
      this.world.add(mesh, paneMesh, doorMesh);
      this.walls.push({ side, mesh, paneMesh, doorMesh, mat });
    }

    // Furniture: one box each, footprint in cells and height in metres (1 world unit = 0.5 m)
    for (const f of room.furniture || []) {
      const hU = f.h / ROW_M;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.06, hU, f.d - 0.06), new THREE.MeshStandardMaterial({ map: T.planks, color: f.color ?? 0x8a6a4a, roughness: 0.85 }));
      mesh.position.set(f.x + f.w / 2, hU / 2, f.z + f.d / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      this.world.add(mesh);
    }

    // Light heatmap overlay
    const heat = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }), w * d);
    i = 0;
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) heat.setMatrixAt(i++, m4.makeTranslation(x + 0.5, 0.02, z + 0.5));
    heat.visible = false;
    this.heat = heat;
    this.updateHeat(grid);
    const col = new THREE.Color();
    this.world.add(heat);

    // Plants: one InstancedMesh of tiny coloured cubes for all of them
    const sub = new THREE.BoxGeometry(SUB, SUB, SUB);
    const all = [];
    placements.forEach((pl, k) => {
      const vox = buildPlantVoxels(pl.plant, 1000 + k * 37 + pl.x * 5 + pl.z);
      for (const p of vox) all.push({ wx: pl.x + 0.5 + p.x * SUB, wy: (p.y + 0.5) * SUB, wz: pl.z + 0.5 + p.z * SUB, c: p.c });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(pl.x + 0.5, 1.1, pl.z + 0.5);
      hit.userData.placement = pl;
      this.world.add(hit);
      this.pickables.push(hit);
      const el = document.createElement('div');
      el.className = 'plant-label';
      el.textContent = pl.plant.name;
      this.labelLayer.appendChild(el);
      this.labels.push({ el, pos: new THREE.Vector3(pl.x + 0.5, 0.6 + (pl.plant.model.h + 2) * SUB, pl.z + 0.5) });
    });
    const plantMesh = new THREE.InstancedMesh(sub, new THREE.MeshStandardMaterial({ roughness: 0.85 }), Math.max(1, all.length));
    plantMesh.count = all.length;
    all.forEach((p, k) => { plantMesh.setMatrixAt(k, m4.makeTranslation(p.wx, p.wy, p.wz)); plantMesh.setColorAt(k, col.setHex(p.c)); });
    plantMesh.castShadow = plantMesh.receiveShadow = true;
    this.world.add(plantMesh);

    // Grow lamps: pole + glowing head + point light
    this.lampLights = [];
    for (const l of lamps) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.y = 1.3;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.7), new THREE.MeshStandardMaterial({ color: 0xffb0e0, emissive: 0xff7ac8, emissiveIntensity: 1.4 }));
      head.position.y = 2.6;
      const pl = new THREE.PointLight(0xff9ad5, 8, 7, 1.6);
      pl.position.y = 2.4;
      g.add(pole, head, pl);
      g.position.set(l.x + 0.5, 0, l.z + 0.5);
      this.world.add(g);
      this.lampLights.push(pl);
    }

    // Scan line
    this.scanQuad = new THREE.Mesh(new THREE.PlaneGeometry(d + 4, WALL_H + 1.5), new THREE.MeshBasicMaterial({ color: 0x57ff9a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.scanQuad.rotation.y = Math.PI / 2;
    this.scanQuad.visible = false;
    this.world.add(this.scanQuad);

    // Camera & sun framing
    const span = Math.max(w, d);
    this.controls.target.set(w / 2, 1, d / 2);
    this.camera.position.set(w / 2 - span * 0.9, span * 0.95, d / 2 - span * 1.25);
    this.controls.minDistance = 4;
    this.controls.maxDistance = span * 4;
    const sc = this.sun.shadow.camera, e = span + 6;
    Object.assign(sc, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 120 });
    sc.updateProjectionMatrix();
    this.setTime(this.timeOfDay);
  }

  /** t in 0..1 from sunrise (east) through noon (south) to sunset (west). */
  setTime(t) {
    this.timeOfDay = t;
    if (!this.room) return;
    const th = t * Math.PI, R = 40;
    const cx = this.room.w / 2, cz = this.room.d / 2;
    const elev = Math.sin(th);
    this.sun.position.set(cx + Math.cos(th) * R, 4 + elev * R * 0.9, cz + 0.5 * elev * R);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.intensity = Math.max(0, elev) ** 0.6 * 2.6;
    const warm = new THREE.Color(0xffa860).lerp(new THREE.Color(0xfff6e0), Math.min(1, elev * 1.6));
    this.sun.color.copy(warm);
    this.hemi.intensity = 0.25 + 0.55 * elev;
    const sky = new THREE.Color(0xff9a6a).lerp(new THREE.Color(0xbfe3ff), Math.min(1, elev * 2));
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
  }

  /**
   * Place the sun from a real direction (unit vector in room axes: +x east, +y up, +z south).
   * Used when the solar model drives the scene instead of the stylised setTime arc.
   */
  setSun(vec, elevation) {
    if (!this.room) return;
    const R = 40, cx = this.room.w / 2, cz = this.room.d / 2;
    const up = Math.max(0, Math.sin((elevation * Math.PI) / 180));
    this.sun.position.set(cx + vec.x * R, Math.max(0.5, vec.y * R), cz + vec.z * R);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.intensity = elevation > 0 ? up ** 0.5 * 2.8 : 0;
    this.sun.color.copy(new THREE.Color(0xffa860).lerp(new THREE.Color(0xfff6e0), Math.min(1, up * 2.2)));
    this.hemi.intensity = 0.2 + 0.6 * up;
    const sky = new THREE.Color(0xff9a6a).lerp(new THREE.Color(0xbfe3ff), Math.min(1, up * 3));
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
  }

  /** Recolour the light map from a 0..1 grid (class boundaries at 0.2 / 0.45 / 0.7). */
  updateHeat(grid) {
    if (!this.heat || !this.room) return;
    const col = new THREE.Color();
    let i = 0;
    for (let x = 0; x < this.room.w; x++) for (let z = 0; z < this.room.d; z++) {
      const v = grid[x][z];
      this.heat.setColorAt(i++, col.setHex(HEAT_COLORS[v >= 0.7 ? 3 : v >= 0.45 ? 2 : v >= 0.2 ? 1 : 0]));
    }
    if (this.heat.instanceColor) this.heat.instanceColor.needsUpdate = true;
  }

  setHeatmap(on) { if (this.heat) this.heat.visible = on; }
  setLabels(on) { this.labelLayer.style.display = on ? '' : 'none'; }

  focus(pl) {
    this.focusTarget = new THREE.Vector3(pl.x + 0.5, 0.8, pl.z + 0.5);
  }

  /** Sweep a scan plane across the room, revealing the world behind it. */
  startScan(done) {
    this.scan = { t0: performance.now(), dur: 2400, done };
    this.renderer.clippingPlanes = [this.clip];
    this.scanQuad.visible = true;
  }

  frame(now) {
    if (this.scan) {
      const k = Math.min(1, (now - this.scan.t0) / this.scan.dur);
      const x = -1 + k * (this.room.w + 3);
      this.clip.constant = x;
      this.scanQuad.position.set(x, (WALL_H + 1.5) / 2 - 0.5, this.room.d / 2);
      if (k >= 1) { this.renderer.clippingPlanes = []; this.scanQuad.visible = false; const d = this.scan.done; this.scan = null; d && d(); }
    }
    if (this.focusTarget) {
      this.controls.target.lerp(this.focusTarget, 0.12);
      const dir = this.camera.position.clone().sub(this.controls.target);
      if (dir.length() > 7) this.camera.position.lerp(this.controls.target.clone().add(dir.setLength(6)), 0.08);
      if (this.controls.target.distanceTo(this.focusTarget) < 0.02) this.focusTarget = null;
    }
    // Fade the walls between the camera and the room so you can always see inside (they keep casting shadows).
    if (this.room) {
      const p = this.camera.position, { w, d } = this.room;
      const hide = { N: p.z < -1, S: p.z > d + 1, W: p.x < -1, E: p.x > w + 1 };
      for (const wl of this.walls) {
        const hidden = hide[wl.side];
        wl.mat.colorWrite = !hidden; wl.mat.depthWrite = !hidden;
        wl.paneMesh.visible = !hidden;
        wl.doorMesh.visible = !hidden;
      }
      const v = new THREE.Vector3();
      const r = this.renderer.domElement.getBoundingClientRect();
      for (const l of this.labels) {
        v.copy(l.pos).project(this.camera);
        const vis = v.z < 1;
        l.el.style.display = vis ? '' : 'none';
        l.el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * r.width}px,${((1 - v.y) / 2) * r.height}px)`;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/** 'window', 'door' or false for one wall block. Window rows follow each window's sill and head height. */
function windowAt(room, wall, along, row) {
  const inSpan = (o) => o.wall === wall && along >= o.pos && along < o.pos + o.width;
  if ((room.doors || []).some((dr) => inSpan(dr) && row < DOOR_ROWS)) return 'door';
  const glazed = room.windows.some((w) => inSpan(w) && row >= Math.round((w.sill ?? 0.5) / ROW_M) && row < Math.round((w.head ?? 1.5) / ROW_M));
  return glazed ? 'window' : false;
}
