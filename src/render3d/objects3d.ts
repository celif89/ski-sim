/**
 * Etap 3D-0: obiekty ośrodka w 3D – wyciągi (podpory z belką i rolkami, stacje, lina jako krzywa zwisu,
 * krzesełka / orczyki jadące tak jak w 2D), budynki (obrysy z OSM i budynki gracza jako bryły z dachem
 * dwuspadowym, śnieg na dachu), tyczki na krawędziach tras, siatki zabezpieczające na stromiznach przy
 * lesie, numery tras jako etykiety, armatki z chmurą śniegu, ratraki ze światłami nocą.
 */
import * as THREE from 'three';
import type { LiftAnalysis, LiftDesign, LiftParams, PointM } from '../sim/lifts';
import type { PisteAnalysis } from '../sim/pistes';
import type { ResortAnalysis, ResortLayout } from '../sim/resort';
import { buildingHeights, minAreaRect } from './buildingShapes';
import type { OrientedRect } from './buildingShapes';
import type { LiftFrame } from './liftGeometry';
import { carrierPositions, cableStrands, liftFrame, ROPE_HALF_M } from './liftGeometry';
import type { Render3DParams } from './params';

const CLASS_COLORS = [0x2f9e44, 0x1c7ed6, 0xe03131, 0x212529];

function lineGeom(pts: { x: number; y: number; z: number }[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts.flatMap((p) => [p.x, p.y, p.z])), 3));
  return g;
}

/** Krzesełko (siedzisko, oparcie, wieszak) – wysokość wieszaka 3,2 m nad siedziskiem. */
function chairGeometry(seats: number): THREE.BufferGeometry {
  const w = Math.max(1.2, seats * 0.55);
  const seat = new THREE.BoxGeometry(w, 0.12, 0.55);
  seat.translate(0, -3.2, 0);
  const back = new THREE.BoxGeometry(w, 0.6, 0.08);
  back.translate(0, -2.85, -0.28);
  const bar = new THREE.BoxGeometry(0.08, 3.2, 0.08);
  bar.translate(0, -1.6, -0.3);
  return mergeSimple([seat, back, bar]);
}

function gondolaGeometry(): THREE.BufferGeometry {
  const cab = new THREE.BoxGeometry(1.9, 2.0, 1.9);
  cab.translate(0, -3.4, 0);
  const bar = new THREE.BoxGeometry(0.1, 2.4, 0.1);
  bar.translate(0, -1.2, 0);
  return mergeSimple([cab, bar]);
}

function tbarGeometry(): THREE.BufferGeometry {
  const pole = new THREE.BoxGeometry(0.06, 1.6, 0.06);
  pole.translate(0, -0.8, 0);
  const t = new THREE.BoxGeometry(0.9, 0.06, 0.06);
  t.translate(0, -1.6, 0);
  return mergeSimple([pole, t]);
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const n = ni.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of ni) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** Bryła budynku z dachem dwuspadowym (kalenica wzdłuż dłuższego boku); ściany i dach osobno. */
export function houseGeometries(r: OrientedRect, baseY: number): { walls: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const { wallM, ridgeM } = buildingHeights(r);
  const walls = new THREE.BoxGeometry(r.lengthM, wallM, r.widthM);
  walls.translate(0, wallM / 2, 0);
  const L = r.lengthM / 2 + 0.4;
  const Wd = r.widthM / 2 + 0.5;
  const v = [
    [-L, wallM, -Wd], [L, wallM, -Wd], [L, wallM + ridgeM, 0], [-L, wallM + ridgeM, 0],
    [-L, wallM, Wd], [L, wallM, Wd], [L, wallM + ridgeM, 0], [-L, wallM + ridgeM, 0],
  ];
  const tri = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 7, 3, 0, 4, 7, 1, 2, 6, 1, 6, 5];
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(tri.flatMap((i) => v[i])), 3));
  roof.computeVertexNormals();
  for (const g of [walls, roof]) {
    g.rotateY(-r.angle);
    g.translate(r.cx, baseY, r.cy);
  }
  return { walls, roof };
}

export interface ObjectsInputs {
  groundAt(x: number, z: number): number;
  lp: LiftParams;
  p: Render3DParams;
  /** Budynki z OSM w układzie lokalnym (obrysy). */
  osmBuildings: PointM[][];
  forest: Float32Array | null;
  widthCells: number;
  cellSizeM: number;
}

export class Objects3D {
  readonly group = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly staticGroup = new THREE.Group();
  private readonly mats = {
    steel: new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.5, metalness: 0.6 }),
    station: new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6, metalness: 0.3 }),
    cable: new THREE.LineBasicMaterial({ color: 0x1f2328 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xc9b79a, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.8 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    net: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    gun: new THREE.MeshStandardMaterial({ color: 0xd9dee5, roughness: 0.5, metalness: 0.3 }),
    groomer: new THREE.MeshStandardMaterial({ color: 0xc92a2a, roughness: 0.6 }),
    beam: new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  private carriers: { design: LiftDesign; an: LiftAnalysis; frame: LiftFrame; mesh: THREE.InstancedMesh }[] = [];
  private readonly plumeGeo = new THREE.BufferGeometry();
  private readonly plumes: THREE.Points;
  private readonly groomerMesh: THREE.InstancedMesh;
  private readonly beamMesh: THREE.InstancedMesh;
  private readonly groomerLights: THREE.PointLight[] = [];
  /** Kable wyciągów i krzesła: odległości do szukania liny dla siedzących gości. */
  cableIndex: { x: number; z: number; y: number }[] = [];
  private labels: THREE.Sprite[] = [];
  carrierCount = 0;

  constructor(private readonly inp: ObjectsInputs) {
    this.group.add(this.staticGroup, this.dynamic);
    this.plumes = new THREE.Points(this.plumeGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }));
    this.plumes.frustumCulled = false;
    this.dynamic.add(this.plumes);
    const gb = new THREE.BoxGeometry(5.5, 2.6, 3.2);
    gb.translate(0, 1.5, 0);
    this.groomerMesh = new THREE.InstancedMesh(gb, this.mats.groomer, 16);
    this.groomerMesh.count = 0;
    this.groomerMesh.castShadow = true;
    const beam = new THREE.ConeGeometry(4, 18, 12, 1, true);
    beam.rotateZ(Math.PI / 2);
    beam.translate(9 + 2.8, 1.8, 0);
    this.beamMesh = new THREE.InstancedMesh(beam, this.mats.beam, 16);
    this.beamMesh.count = 0;
    this.dynamic.add(this.groomerMesh, this.beamMesh);
    for (let k = 0; k < 3; k++) {
      const l = new THREE.PointLight(0xfff0d0, 0, 60, 1.6);
      this.groomerLights.push(l);
      this.dynamic.add(l);
    }
    this.buildOsmBuildings();
  }

  private buildOsmBuildings(): void {
    const walls: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    for (const poly of this.inp.osmBuildings) {
      if (poly.length < 3) continue;
      const r = minAreaRect(poly);
      if (r.lengthM < 3 || r.lengthM > 120) continue;
      const y = this.inp.groundAt(r.cx, r.cy);
      if (!Number.isFinite(y)) continue;
      const g = houseGeometries(r, y - 0.3);
      walls.push(g.walls);
      roofs.push(g.roof);
    }
    if (!walls.length) return;
    const wm = new THREE.Mesh(mergeSimple(walls), this.mats.wall);
    const rm = new THREE.Mesh(mergeSimple(roofs), this.mats.roof);
    for (const m of [wm, rm]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.staticGroup.add(m);
    }
  }

  /** Śnieg na dachach (0–1). */
  setRoofSnow(s: number): void {
    this.mats.roof.color.setRGB(0.48 + (0.93 - 0.48) * s, 0.23 + (0.95 - 0.23) * s, 0.18 + (0.98 - 0.18) * s);
  }

  /** Nowy układ ośrodka: wyciągi, budynki gracza, tyczki, siatki, numery tras. */
  setLayout(layout: ResortLayout, analysis: ResortAnalysis, pisteSlope: (x: number, z: number) => number): void {
    for (const ch of [...this.staticGroup.children]) if (ch.userData.layout) {
      this.staticGroup.remove(ch);
      (ch as THREE.Mesh).geometry?.dispose();
    }
    for (const c of this.carriers) {
      this.dynamic.remove(c.mesh);
      c.mesh.dispose();
    }
    for (const l of this.labels) this.dynamic.remove(l);
    this.labels = [];
    this.carriers = [];
    this.cableIndex = [];
    const add = (o: THREE.Object3D) => {
      o.userData.layout = true;
      this.staticGroup.add(o);
    };
    const sag = this.inp.lp.common.cableSagRatio;
    const towerParts: THREE.BufferGeometry[] = [];
    const stationParts: THREE.BufferGeometry[] = [];
    for (const l of layout.lifts) {
      const an = analysis.lifts.get(l.id);
      if (!an || !an.ok) continue;
      const f = liftFrame(l, an, sag);
      const aerial = an.type.kind === 'aerial';
      // Podpory: słup do liny + belka w poprzek z rolkami.
      for (const s of an.supports) {
        if (s.kind === 'station') continue;
        const p = f.point(s.distanceM);
        const h = f.dirAt(s.distanceM);
        const g0 = this.inp.groundAt(p.xM, p.yM);
        const top = s.cableElevationM + (aerial ? 0.6 : 0.4);
        const col = new THREE.CylinderGeometry(aerial ? 0.35 : 0.2, aerial ? 0.55 : 0.3, top - g0, 8);
        col.translate(p.xM, (top + g0) / 2, p.yM);
        towerParts.push(col);
        const beam = new THREE.BoxGeometry(0.4, 0.3, (aerial ? ROPE_HALF_M : 1.2) * 2 + 1.4);
        beam.rotateY(-h);
        beam.translate(p.xM, top, p.yM);
        towerParts.push(beam);
      }
      // Stacje: bryła przy dolnej i górnej stacji (koło zwrotne).
      for (const [d, isTop] of [
        [0, false],
        [an.horizontalLengthM, true],
      ] as const) {
        const p = f.point(d);
        const h = f.dirAt(d);
        const g0 = this.inp.groundAt(p.xM, p.yM);
        const size = aerial ? 9 : 4;
        const box = new THREE.BoxGeometry(size * (isTop ? 1 : 1.3), aerial ? 4.5 : 2.6, size);
        box.rotateY(-h);
        box.translate(p.xM - Math.cos(h) * (isTop ? -2 : 2), g0 + (aerial ? 2.25 : 1.3), p.yM - Math.sin(h) * (isTop ? -2 : 2));
        stationParts.push(box);
      }
      // Lina.
      for (const strand of cableStrands(f, aerial ? ROPE_HALF_M : 1.2, 6)) {
        add(new THREE.Line(lineGeom(strand), this.mats.cable));
        for (let k = 0; k < strand.length; k += 2) this.cableIndex.push(strand[k]);
      }
      // Krzesełka / gondole / orczyki (instancje, położenia co klatkę).
      const t = an.type;
      if (t.carrierSeats > 0) {
        const geo = t.id === 'gondola' ? gondolaGeometry() : aerial ? chairGeometry(t.carrierSeats) : tbarGeometry();
        const est = Math.ceil((2 * (an.slopeLengthM || an.horizontalLengthM)) / Math.max(1, (t.speedMs * 3600 * t.carrierSeats) / t.capacityPerHour)) + 4;
        const mesh = new THREE.InstancedMesh(geo, this.mats.chair, est);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        this.dynamic.add(mesh);
        this.carriers.push({ design: l, an, frame: f, mesh });
      }
    }
    if (towerParts.length) {
      const m = new THREE.Mesh(mergeSimple(towerParts), this.mats.steel);
      m.castShadow = true;
      add(m);
    }
    if (stationParts.length) {
      const m = new THREE.Mesh(mergeSimple(stationParts), this.mats.station);
      m.castShadow = true;
      m.receiveShadow = true;
      add(m);
    }
    // Budynki gracza (bazy i budynki) – bryły z dachem.
    const walls: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    for (const b of [...layout.bases, ...(layout.buildings ?? [])] as { xM: number; yM: number; typeId?: string; rotDeg?: number }[]) {
      const big = !b.typeId || b.typeId === 'parking' ? null : b.typeId === 'gastronomy' ? [26, 14] : b.typeId === 'bar' ? [12, 8] : [14, 9];
      if (!big) continue;
      const r: OrientedRect = { cx: b.xM, cy: b.yM, lengthM: big[0], widthM: big[1], angle: ((b.rotDeg ?? 0) * Math.PI) / 180 };
      const y = this.inp.groundAt(b.xM, b.yM);
      if (!Number.isFinite(y)) continue;
      const g = houseGeometries(r, y - 0.3);
      walls.push(g.walls);
      roofs.push(g.roof);
    }
    if (walls.length) {
      const wm = new THREE.Mesh(mergeSimple(walls), this.mats.wall);
      const rm = new THREE.Mesh(mergeSimple(roofs), this.mats.roof);
      wm.castShadow = rm.castShadow = true;
      add(wm);
      add(rm);
    }
    // Tyczki na krawędziach tras, siatki na stromiznach przy lesie, numery tras.
    const pp = this.inp.p.pistes;
    const poles: THREE.Matrix4[] = [];
    const poleColors: THREE.Color[] = [];
    const nets: THREE.BufferGeometry[] = [];
    for (const piste of layout.pistes) {
      const a: PisteAnalysis | undefined = analysis.pistes.get(piste.id);
      if (!a) continue;
      const ax = a.axis.filter((q) => Number.isFinite(q.elevationM));
      const color = new THREE.Color(CLASS_COLORS[a.classIndex] ?? 0x1c7ed6);
      let acc = 0;
      for (let k = 1; k < ax.length; k++) {
        const q0 = ax[k - 1];
        const q1 = ax[k];
        const seg = Math.hypot(q1.xM - q0.xM, q1.yM - q0.yM);
        acc += seg;
        if (acc < pp.poleSpacingM) continue;
        acc = 0;
        const dx = (q1.xM - q0.xM) / (seg || 1);
        const dz = (q1.yM - q0.yM) / (seg || 1);
        for (const side of [1, -1]) {
          const x = q1.xM - dz * side * (q1.widthM / 2);
          const z = q1.yM + dx * side * (q1.widthM / 2);
          const y = this.inp.groundAt(x, z);
          if (!Number.isFinite(y)) continue;
          poles.push(new THREE.Matrix4().makeTranslation(x, y + pp.poleHeightM / 2, z));
          poleColors.push(color);
          const slope = pisteSlope(q1.xM, q1.yM);
          const fx = Math.floor((x - dz * side * 4) / this.inp.cellSizeM);
          const fz = Math.floor((z + dx * side * 4) / this.inp.cellSizeM);
          const forestNear = this.inp.forest ? (this.inp.forest[fz * this.inp.widthCells + fx] ?? 0) : 0;
          if (slope >= pp.netSlopePercent && forestNear > 0.4) {
            const net = new THREE.PlaneGeometry(pp.poleSpacingM, pp.netHeightM);
            net.rotateY(-Math.atan2(dz, dx));
            net.translate(x - dx * pp.poleSpacingM * 0.5, y + pp.netHeightM / 2, z - dz * pp.poleSpacingM * 0.5);
            nets.push(net);
          }
        }
      }
      // Numer trasy przy górze.
      const top = ax[Math.min(ax.length - 1, 3)];
      if (top) this.labels.push(this.label(piste.name, CLASS_COLORS[a.classIndex] ?? 0x1c7ed6, top.xM, this.inp.groundAt(top.xM, top.yM) + 14, top.yM));
    }
    if (poles.length) {
      const pg = new THREE.CylinderGeometry(0.03, 0.03, pp.poleHeightM, 5);
      const im = new THREE.InstancedMesh(pg, this.mats.pole, poles.length);
      poles.forEach((m, i) => {
        im.setMatrixAt(i, m);
        im.setColorAt(i, poleColors[i]);
      });
      add(im);
    }
    if (nets.length) add(new THREE.Mesh(mergeSimple(nets), this.mats.net));
    for (const l of this.labels) this.dynamic.add(l);
  }

  private label(text: string, color: number, x: number, y: number, z: number): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 60px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.slice(0, 3), 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    s.scale.set(0.024, 0.024, 1);
    s.position.set(x, y, z);
    s.renderOrder = 10;
    return s;
  }

  /** Co klatkę: krzesełka z czasu gry, ratraki, armatki z chmurą. */
  update(
    timeS: number,
    night: number,
    groomers: { xM: number; yM: number; headingRad: number; lightsOn: boolean }[],
    plumes: { xM: number; yM: number; aimXM: number; aimYM: number; rateM3h: number; windFromDeg: number; windMs: number }[],
    cam: THREE.Vector3,
  ): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let total = 0;
    for (const c of this.carriers) {
      const list = carrierPositions(c.design, c.an, c.frame, timeS);
      const n = Math.min(list.length, c.mesh.instanceMatrix.count);
      for (let i = 0; i < n; i++) {
        const k = list[i];
        q.setFromAxisAngle(up, -k.heading + Math.PI / 2);
        m.compose(new THREE.Vector3(k.x, k.y, k.z), q, one);
        c.mesh.setMatrixAt(i, m);
      }
      c.mesh.count = n;
      c.mesh.instanceMatrix.needsUpdate = true;
      total += n;
    }
    this.carrierCount = total;
    // Ratraki.
    const gs = groomers.slice(0, 16);
    let b = 0;
    gs.forEach((g, i) => {
      const y = this.inp.groundAt(g.xM, g.yM);
      q.setFromAxisAngle(up, -g.headingRad);
      m.compose(new THREE.Vector3(g.xM, y, g.yM), q, one);
      this.groomerMesh.setMatrixAt(i, m);
      if (g.lightsOn && night > 0.2) {
        const qb = new THREE.Quaternion().setFromAxisAngle(up, -g.headingRad);
        m.compose(new THREE.Vector3(g.xM, y, g.yM), qb, one);
        this.beamMesh.setMatrixAt(b++, m);
      }
    });
    this.groomerMesh.count = gs.length;
    this.groomerMesh.instanceMatrix.needsUpdate = true;
    this.beamMesh.count = b;
    this.beamMesh.instanceMatrix.needsUpdate = true;
    const lit = gs.filter((g) => g.lightsOn && night > 0.2).sort((a, c) => Math.hypot(a.xM - cam.x, a.yM - cam.z) - Math.hypot(c.xM - cam.x, c.yM - cam.z));
    this.groomerLights.forEach((l, i) => {
      const g = lit[i];
      l.intensity = g ? 400 * night : 0;
      if (g) l.position.set(g.xM + Math.cos(g.headingRad) * 8, this.inp.groundAt(g.xM, g.yM) + 3, g.yM + Math.sin(g.headingRad) * 8);
    });
    // Armatki: cząsteczki znoszone wiatrem (stały wzór z czasu – bez losowania co klatkę).
    const pts: number[] = [];
    const per = 120;
    for (const p of plumes.slice(0, 40)) {
      const y0 = this.inp.groundAt(p.xM, p.yM) + 3;
      const ax = p.aimXM - p.xM;
      const az = p.aimYM - p.yM;
      const al = Math.hypot(ax, az) || 1;
      const wr = ((p.windFromDeg + 180) * Math.PI) / 180;
      const wx = Math.sin(wr) * p.windMs * 3;
      const wz = -Math.cos(wr) * p.windMs * 3;
      for (let k = 0; k < per; k++) {
        const t = ((k / per + timeS * 0.25) % 1 + 1) % 1;
        const j1 = Math.sin(k * 12.9898) * 43758.5453;
        const j2 = Math.sin(k * 78.233) * 12543.123;
        const sx = j1 - Math.floor(j1) - 0.5;
        const sz = j2 - Math.floor(j2) - 0.5;
        const d = t * 25;
        pts.push(p.xM + (ax / al) * d + wx * t + sx * 6 * t, y0 + 4 * Math.sin(Math.PI * t) - 3 * t * t, p.yM + (az / al) * d + wz * t + sz * 6 * t);
      }
    }
    this.plumeGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3));
    // Armatki jako modele (statyczne położenia – bez nowej geometrii co klatkę).
    this.updateGuns(plumes);
  }

  private gunMesh: THREE.InstancedMesh | null = null;
  private gunKey = '';
  private updateGuns(plumes: { xM: number; yM: number; aimXM: number; aimYM: number }[]): void {
    const key = plumes.map((p) => `${p.xM.toFixed(0)},${p.yM.toFixed(0)}`).join('|');
    if (key === this.gunKey) return;
    this.gunKey = key;
    if (this.gunMesh) {
      this.dynamic.remove(this.gunMesh);
      this.gunMesh.dispose();
    }
    if (!plumes.length) {
      this.gunMesh = null;
      return;
    }
    const body = new THREE.CylinderGeometry(0.9, 0.9, 1.4, 12);
    body.rotateZ(Math.PI / 2);
    body.translate(0, 2.4, 0);
    const leg = new THREE.BoxGeometry(0.2, 2, 0.2);
    leg.translate(0, 1, 0);
    const geo = mergeSimple([body, leg]);
    const im = new THREE.InstancedMesh(geo, this.mats.gun, plumes.length);
    const up = new THREE.Vector3(0, 1, 0);
    plumes.forEach((p, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(up, -Math.atan2(p.aimYM - p.yM, p.aimXM - p.xM));
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.xM, this.inp.groundAt(p.xM, p.yM), p.yM), q, new THREE.Vector3(1, 1, 1)));
    });
    im.castShadow = true;
    this.gunMesh = im;
    this.dynamic.add(im);
  }
}
