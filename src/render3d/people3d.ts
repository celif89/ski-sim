/**
 * Etap 3D-0: goście w 3D – postacie niskopoligonowe instancjonowane (kurtka w kolorze z ziarna jak w 2D,
 * narty albo deska, pochylenie w skręcie), z tych samych ramek wątku gości co mapa 2D (położenie
 * przesuwane prędkością między ramkami). Siedzący na krzesełku – pod liną najbliższego wyciągu.
 */
import * as THREE from 'three';

const STRIDE = 9;
const KIND_SKI = 0;
const KIND_BOARD = 1;
const KIND_SEATED = 3;
const KIND_BIKE = 5;
const MAX_EXTRAPOLATION_S = 3;
const JACKETS = [0xd92b2b, 0x1c64d8, 0xf59e0b, 0x2f9e44, 0x7b3fbf, 0x0f9fb0, 0xe64980, 0x212529];

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const n = parts.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const q = p.index ? p.toNonIndexed() : p;
    pos.set(q.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(q.getAttribute('normal').array as Float32Array, o * 3);
    o += q.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

export class People3D {
  /** Materiały (do cieni kaskadowych). */
  readonly materials: THREE.Material[];
  readonly group = new THREE.Group();
  private readonly jacket: THREE.InstancedMesh;
  private readonly dark: THREE.InstancedMesh;
  private readonly skis: THREE.InstancedMesh;
  private readonly boards: THREE.InstancedMesh;
  private cableHash = new Map<number, { x: number; y: number; z: number }[]>();
  drawn = 0;

  constructor(private max: number, heightM: number, private readonly seatHeightM: number) {
    const h = heightM / 1.75;
    const torso = box(0.42 * h, 0.62 * h, 0.26 * h, 0, 1.15 * h, 0);
    const legs = merge([box(0.16 * h, 0.8 * h, 0.18 * h, -0.11 * h, 0.42 * h, 0), box(0.16 * h, 0.8 * h, 0.18 * h, 0.11 * h, 0.42 * h, 0)]);
    const head = new THREE.IcosahedronGeometry(0.13 * h, 0).toNonIndexed();
    head.translate(0, 1.6 * h, 0);
    const darkG = merge([legs, head]);
    const skiG = merge([box(0.08, 0.03, 1.7, -0.12, 0.02, 0.1), box(0.08, 0.03, 1.7, 0.12, 0.02, 0.1)]);
    const boardG = box(0.3, 0.03, 1.5, 0, 0.02, 0);
    const matJ = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const matD = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.8 });
    const matG = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.3 });
    this.jacket = new THREE.InstancedMesh(torso, matJ, max);
    this.dark = new THREE.InstancedMesh(darkG, matD, max);
    this.skis = new THREE.InstancedMesh(skiG, matG, max);
    this.boards = new THREE.InstancedMesh(boardG, matG, max);
    this.materials = [matJ, matD, matG];
    for (const m of [this.jacket, this.dark, this.skis, this.boards]) {
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  /** Punkty lin wyciągów (siedzący goście zawieszeni pod liną). */
  setCables(pts: { x: number; y: number; z: number }[]): void {
    this.cableHash.clear();
    for (const p of pts) {
      const k = Math.floor(p.x / 20) * 100000 + Math.floor(p.z / 20);
      let a = this.cableHash.get(k);
      if (!a) this.cableHash.set(k, (a = []));
      a.push(p);
    }
  }

  private cableY(x: number, z: number): number | null {
    let best: { d: number; y: number } | null = null;
    const ci = Math.floor(x / 20);
    const cj = Math.floor(z / 20);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const p of this.cableHash.get((ci + di) * 100000 + cj + dj) ?? []) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (!best || d < best.d) best = { d, y: p.y };
      }
    }
    return best && best.d < 25 ? best.y : null;
  }

  update(frame: { data: Float32Array<ArrayBufferLike>; count: number; timeS: number; summer: boolean }, renderTimeS: number, groundAt: (x: number, z: number) => number, cam: THREE.Vector3, maxDistM: number): void {
    const d = frame.data;
    const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, renderTimeS - frame.timeS));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    let n = 0;
    let ns = 0;
    let nb = 0;
    for (let k = 0; k < frame.count && n < this.max; k++) {
      const o = k * STRIDE;
      const x = d[o + 1] + d[o + 3] * dt;
      const z = d[o + 2] + d[o + 4] * dt;
      if (Math.hypot(x - cam.x, z - cam.z) > maxDistM) continue;
      const kind = d[o + 6];
      const variant = d[o + 7];
      const child = variant >= 16;
      const phase = d[o + 8];
      let y = groundAt(x, z);
      if (!Number.isFinite(y)) continue;
      const seated = kind === KIND_SEATED;
      if (seated) {
        const cy = this.cableY(x, z);
        if (cy !== null) y = cy - this.seatHeightM - 1.4;
      }
      const sc = child ? 0.7 : 1;
      const heading = d[o + 5];
      const skier = !frame.summer && (kind === KIND_SKI || kind === KIND_BOARD);
      const lean = skier ? Math.sin(phase * Math.PI * 2) * 0.35 : 0;
      e.set(seated ? -0.6 : skier ? 0.25 : 0, -heading + Math.PI / 2, lean, 'YXZ');
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc, seated ? sc * 0.75 : sc, sc));
      this.jacket.setMatrixAt(n, m);
      this.jacket.setColorAt(n, col.setHex(JACKETS[(variant % 16) % JACKETS.length]));
      this.dark.setMatrixAt(n, m);
      if (skier && kind === KIND_SKI) this.skis.setMatrixAt(ns++, m);
      else if ((skier && kind === KIND_BOARD) || (frame.summer && kind === KIND_BIKE)) this.boards.setMatrixAt(nb++, m);
      n++;
    }
    this.jacket.count = n;
    this.dark.count = n;
    this.skis.count = ns;
    this.boards.count = nb;
    for (const im of [this.jacket, this.dark, this.skis, this.boards]) im.instanceMatrix.needsUpdate = true;
    if (this.jacket.instanceColor) this.jacket.instanceColor.needsUpdate = true;
    this.drawn = n;
  }
}
