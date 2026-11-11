/**
 * Etap 3D-0: las – świerki i kosodrzewina z warstwy pokrycia (ESA WorldCover), rozmieszczone tak jak
 * w 2D (`treesInRect` z illustration.ts, to samo ziarno i siatka). Blisko kamery instancjonowane modele
 * niskopoligonowe generowane kodem (kilka wariantów, z cieniem), dalej skrzyżowane płaskie obrazki.
 * Zimą śnieg na gałęziach (biel na górnych płaszczyznach wg grubości śniegu). Etap 3D-3: czapy każdego
 * drzewa wg grubości śniegu w jego komórce (pełne od `treeSnowFullM`); pień stoi w śniegu.
 */
import * as THREE from 'three';
import { treesInRect } from '../render/illustration';
import type { Render3DParams } from './params';
import type { HeightField } from './terrainMesh';
import { sampleHeight } from './terrainMesh';
import { SNOW_DEPTH_GLSL } from './snowSurface';
import type { SnowUniforms } from './terrain3d';

/** Grubość śniegu pod drzewem (środek instancji) → czapa 0–1 (GLSL, shader wierzchołków). */
const TREE_SNOW_VERTEX = /* glsl */ `
  #ifdef USE_INSTANCING
    vec4 ipW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #else
    vec4 ipW = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  vCap = uTreeSnow * smoothstep(0.0, uTreeSnowFull, snowDepthAt(ipW.xz));`;

const CHUNK_M = 500;

/** Świerk: pień + 4–6 stożków piętrami, odcień i smukłość wg wariantu. Wysokość 1 (skalowana instancją). */
export function spruceGeometry(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.018, 0.028, 0.18, 5);
  trunk.translate(0, 0.09, 0);
  paint(trunk, 0.24, 0.17, 0.11);
  parts.push(trunk);
  const tiers = 3 + (variant % 3);
  const slim = 0.26 + 0.05 * ((variant * 7) % 3);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const r = slim * (1 - f * 0.8);
    const h = 0.38 * (1 - f * 0.45);
    const cone = new THREE.ConeGeometry(r, h, 6, 1, true);
    cone.translate(0, 0.14 + f * 0.78 + h / 2, 0);
    const g = 0.24 + 0.05 * ((variant + t) % 3) * 0.5;
    paint(cone, 0.1 + 0.02 * (variant % 2), g, 0.12);
    parts.push(cone);
  }
  return merge(parts);
}

/** Kosodrzewina: spłaszczona bryła. */
export function shrubGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1.6, 0.6, 1.3);
  g.translate(0, 0.3, 0);
  paint(g, 0.1, 0.22, 0.1);
  return g;
}

function paint(g: THREE.BufferGeometry, r: number, gg: number, b: number): void {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const total = ni.reduce((a, p) => a + p.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of ni) {
    p.computeVertexNormals();
    const n = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Obrazek świerka (sylwetka) do dalekich drzew – rysowany na płótnie. */
function impostorTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3d2a1a';
  x.fillRect(29, 110, 6, 18);
  for (let t = 0; t < 6; t++) {
    const f = t / 6;
    const w = 30 * (1 - f * 0.8);
    const y0 = 116 - f * 100;
    x.fillStyle = t % 2 ? '#2a4a2c' : '#305434';
    x.beginPath();
    x.moveTo(32 - w, y0);
    x.lineTo(32 + w, y0);
    x.lineTo(32, y0 - 40 * (1 - f * 0.4));
    x.closePath();
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dwie skrzyżowane płaszczyzny 1 × 1 (dół w 0). */
function crossQuad(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(0.62, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const ai = a.toNonIndexed();
  const bi = b.toNonIndexed();
  const cat = (n: string, k: number) => {
    const x = ai.getAttribute(n).array as Float32Array;
    const y = bi.getAttribute(n).array as Float32Array;
    const out = new Float32Array(x.length + y.length);
    out.set(x);
    out.set(y, x.length);
    g.setAttribute(n, new THREE.BufferAttribute(out, k));
  };
  cat('position', 3);
  cat('normal', 3);
  cat('uv', 2);
  // Normalne do góry: z daleka obrazki oświetlone jak korony drzew widziane z góry (bez czarnych plam).
  const nr = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  return g;
}

interface ForestChunk {
  cx: number;
  cz: number;
  /** x, y, z, wysokość, odcień, wariant – po kolei. */
  trees: Float32Array;
  shrubs: Float32Array;
  near: THREE.InstancedMesh[] | null;
  far: THREE.InstancedMesh | null;
  state: 'none' | 'near' | 'far';
}

export class Forest3D {
  readonly group = new THREE.Group();
  private readonly chunks: ForestChunk[] = [];
  private readonly spruces: THREE.BufferGeometry[];
  private readonly shrub: THREE.BufferGeometry;
  private readonly cross: THREE.BufferGeometry;
  readonly treeMaterial: THREE.MeshStandardMaterial;
  private readonly farMaterial: THREE.MeshStandardMaterial;
  private readonly snowU = { value: 0 };
  nearM = 800;
  /** Liczba drzew rysowanych jako modele 3D i jako obrazki (licznik). */
  nearCount = 0;
  farCount = 0;

  constructor(
    hf: HeightField,
    forest: Float32Array,
    shrub: Float32Array | null,
    private readonly p: Render3DParams,
    snow?: { snowU: SnowUniforms; uTreeSnowFull: { value: number } },
  ) {
    const fp = p.forest;
    this.spruces = Array.from({ length: fp.variants }, (_, v) => spruceGeometry(v));
    this.shrub = shrubGeometry();
    this.cross = crossQuad();
    this.treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const snowU = this.snowU;
    // Bez danych o grubości (testy) – czapa wspólna dla całego lasu (uTreeSnow).
    const capV = snow ? TREE_SNOW_VERTEX : 'vCap = uTreeSnow;';
    const capHead = snow ? `uniform float uTreeSnow;\nuniform float uTreeSnowFull;\n${SNOW_DEPTH_GLSL}` : 'uniform float uTreeSnow;';
    const capU = () => (snow ? { uTreeSnow: snowU, uTreeSnowFull: snow.uTreeSnowFull, ...snow.snowU } : { uTreeSnow: snowU });
    this.treeMaterial.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, capU());
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\nvarying float vUp;\nvarying float vCap;\n${capHead}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nvUp = objectNormal.y;\n${capV}`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vUp;\nvarying float vCap;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), vCap * 0.85 * smoothstep(0.25, 0.55, vUp));');
    };
    this.farMaterial = new THREE.MeshStandardMaterial({ map: impostorTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    this.farMaterial.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, capU());
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\nvarying float vCap;\n${capHead}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${capV}`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCap;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), vCap * 0.45 * step(0.5, fract(vMapUv.y * 6.0)));');
    };
    const W = hf.widthCells * hf.cellSizeM;
    const H = hf.heightCells * hf.cellSizeM;
    const cs = hf.cellSizeM;
    const at = (arr: Float32Array | null) => (x: number, y: number) => {
      if (!arr) return 0;
      const i = Math.floor(x / cs);
      const j = Math.floor(y / cs);
      if (i < 0 || j < 0 || i >= hf.widthCells || j >= hf.heightCells) return 0;
      return arr[j * hf.widthCells + i];
    };
    for (let y0 = 0; y0 < H; y0 += CHUNK_M) {
      for (let x0 = 0; x0 < W; x0 += CHUNK_M) {
        const x1 = Math.min(W, x0 + CHUNK_M);
        const y1 = Math.min(H, y0 + CHUNK_M);
        const t = treesInRect(x0, y0, x1, y1, at(forest), fp.seed, { spacingM: fp.spacingM, heightM: fp.heightM, layer: 31 });
        const s = shrub ? treesInRect(x0, y0, x1, y1, at(shrub), fp.seed, { spacingM: fp.shrubSpacingM, heightM: fp.shrubHeightM, layer: 37 }) : [];
        const pack = (list: typeof t) => {
          const out: number[] = [];
          for (const q of list) {
            const z = sampleHeight(hf, q.xM, q.yM);
            if (!Number.isFinite(z)) continue;
            out.push(q.xM, z, q.yM, q.heightM, q.tone, Math.floor(q.tone * fp.variants) % fp.variants);
          }
          return Float32Array.from(out);
        };
        this.chunks.push({ cx: (x0 + x1) / 2, cz: (y0 + y1) / 2, trees: pack(t), shrubs: pack(s), near: null, far: null, state: 'none' });
      }
    }
  }

  /** Wycinka: drzewa w komórkach z maską usunięte (przecinki pod wyciągami i trasami). */
  setCleared(mask: Uint8Array | null, hf: HeightField): void {
    if (!mask) return;
    const cs = hf.cellSizeM;
    const keep = (arr: Float32Array) => {
      const out: number[] = [];
      for (let k = 0; k < arr.length; k += 6) {
        const i = Math.floor(arr[k] / cs);
        const j = Math.floor(arr[k + 2] / cs);
        if (mask[j * hf.widthCells + i]) continue;
        for (let q = 0; q < 6; q++) out.push(arr[k + q]);
      }
      return Float32Array.from(out);
    };
    for (const c of this.chunks) {
      (c as { trees: Float32Array }).trees = keep(c.trees);
      (c as { shrubs: Float32Array }).shrubs = keep(c.shrubs);
      for (const m of c.near ?? []) {
        this.group.remove(m);
        m.dispose();
      }
      if (c.far) {
        this.group.remove(c.far);
        c.far.dispose();
      }
      c.near = null;
      c.far = null;
      c.state = 'none';
    }
  }

  /** Materiały (do cieni kaskadowych). */
  get materials(): THREE.Material[] {
    return [this.treeMaterial, this.farMaterial];
  }

  setSnow(onBranches: number): void {
    this.snowU.value = onBranches;
  }

  private buildNear(c: ForestChunk): THREE.InstancedMesh[] {
    const fp = this.p.forest;
    const out: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let v = 0; v < fp.variants; v++) {
      const idx: number[] = [];
      for (let k = 0; k < c.trees.length; k += 6) if (c.trees[k + 5] === v) idx.push(k);
      if (!idx.length) continue;
      const im = new THREE.InstancedMesh(this.spruces[v], this.treeMaterial, idx.length);
      idx.forEach((k, n) => {
        const h = c.trees[k + 3];
        q.setFromAxisAngle(up, c.trees[k + 4] * Math.PI * 2);
        s.set(h, h, h);
        m.compose(new THREE.Vector3(c.trees[k], c.trees[k + 1] - 0.3, c.trees[k + 2]), q, s);
        im.setMatrixAt(n, m);
        const t = 0.85 + 0.3 * c.trees[k + 4];
        im.setColorAt(n, col.setRGB(t, t, t));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      out.push(im);
    }
    if (c.shrubs.length) {
      const n = c.shrubs.length / 6;
      const im = new THREE.InstancedMesh(this.shrub, this.treeMaterial, n);
      for (let k = 0; k < n; k++) {
        const o = k * 6;
        const h = c.shrubs[o + 3];
        q.setFromAxisAngle(up, c.shrubs[o + 4] * 6.28);
        s.set(h * 1.4, h, h * 1.4);
        m.compose(new THREE.Vector3(c.shrubs[o], c.shrubs[o + 1] - 0.2, c.shrubs[o + 2]), q, s);
        im.setMatrixAt(k, m);
      }
      im.receiveShadow = true;
      out.push(im);
    }
    for (const im of out) {
      im.computeBoundingSphere();
      this.group.add(im);
    }
    return out;
  }

  private buildFar(c: ForestChunk): THREE.InstancedMesh {
    const n = c.trees.length / 6;
    const im = new THREE.InstancedMesh(this.cross, this.farMaterial, Math.max(1, n));
    im.count = n;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const o = k * 6;
      const h = c.trees[o + 3];
      q.setFromAxisAngle(up, c.trees[o + 4] * Math.PI);
      s.set(h, h, h);
      m.compose(new THREE.Vector3(c.trees[o], c.trees[o + 1] - 0.3, c.trees[o + 2]), q, s);
      im.setMatrixAt(k, m);
    }
    im.computeBoundingSphere();
    this.group.add(im);
    return im;
  }

  /** Co klatkę: blisko – modele 3D, dalej – obrazki (budowane przy pierwszej potrzebie). */
  update(cam: THREE.Vector3): void {
    let nn = 0;
    let ff = 0;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - CHUNK_M * 0.7);
      const want: ForestChunk['state'] = d < this.nearM ? 'near' : 'far';
      if (want !== c.state) {
        if (want === 'near' && !c.near) c.near = this.buildNear(c);
        if (want === 'far' && !c.far) c.far = this.buildFar(c);
        for (const m of c.near ?? []) m.visible = want === 'near';
        if (c.far) c.far.visible = want === 'far';
        c.state = want;
      }
      if (want === 'near') nn += c.trees.length / 6;
      else ff += c.trees.length / 6;
    }
    this.nearCount = nn;
    this.farCount = ff;
  }
}
