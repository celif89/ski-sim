/**
 * Etap 3D-1: linie przyklejone do terenu (drogi, potoki, rurociągi, rowy, szlaki, trasy letnie,
 * podglądy budowy). Oś linii próbkowana co kilka metrów po terenie; szerokość w metrach, ale nie
 * mniejsza niż kilka pikseli ekranu (rozszerzanie w shaderze – bez przeliczania geometrii przy ruchu
 * kamery); linia uniesiona nad teren tym bardziej, im dalej od kamery (zgrubniejsza siatka terenu
 * w oddali). Przerywane – kreski w pikselach przy celu kamery. Druga warstwa „za wzgórzem” (test
 * głębokości odwrócony) – przerywana i półprzezroczysta (podglądy budowy, zaznaczenie).
 */
import * as THREE from 'three';
import { SNOW_DEPTH_GLSL } from './snowSurface';
import type { SnowUniforms } from './terrain3d';

export interface P2 {
  xM: number;
  yM: number;
}

export interface LineStyle {
  /** Kolor 0xRRGGBB. */
  color: number;
  /** Szerokość w metrach (na ziemi). */
  widthM: number;
  /** Najmniejsza szerokość na ekranie [px]. */
  minPx: number;
  /** Kreska i przerwa [px przy celu kamery]; brak – linia ciągła. */
  dashPx?: [number, number];
  /** Kolejność rysowania (wyższe – na wierzchu). */
  order?: number;
}

export interface DrapedPoint {
  x: number;
  y: number;
  z: number;
  /** Odległość wzdłuż linii [m]. */
  along: number;
}

/**
 * Oś linii przyklejona do terenu: punkty co najwyżej co `stepM` (wierzchołki łamanej zachowane),
 * wysokość z terenu. Fragmenty poza mapą (NaN) przerywają linię – wynik to lista kawałków.
 */
export function drapePolyline(pts: P2[], groundAt: (x: number, z: number) => number, stepM: number): DrapedPoint[][] {
  const out: DrapedPoint[][] = [];
  let cur: DrapedPoint[] = [];
  let along = 0;
  const push = (x: number, z: number) => {
    const y = groundAt(x, z);
    if (!Number.isFinite(y)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      return;
    }
    cur.push({ x, y, z, along });
  };
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      push(pts[0].xM, pts[0].yM);
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      along += L / n;
      push(a.xM + (b.xM - a.xM) * t, a.yM + (b.yM - a.yM) * t);
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

const VERT = /* glsl */ `
attribute vec2 aDir;
attribute float aSide;
attribute float aAlong;
attribute float aHalfM;
attribute float aMinPx;
attribute vec3 aColor;
attribute vec2 aDash;
uniform float uPxScale;
uniform float uLift;
uniform float uMppTarget;
${SNOW_DEPTH_GLSL}
varying float vAlong;
varying vec3 vColor;
varying vec2 vDash;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  float d = distance(p, cameraPosition);
  float mpp = d * uPxScale;
  float hw = max(aHalfM, aMinPx * 0.5 * mpp);
  vec2 n = vec2(-aDir.y, aDir.x);
  p.xz += n * aSide * hw;
  // Etap 3D-3: linia leży na śniegu (teren + grubość pokrywy, ten sam wzór co teren).
  p.y += 0.25 + d * uLift + uSnowExag * snowDepthAt(p.xz);
  vAlong = aAlong;
  vColor = aColor;
  vDash = aDash * uMppTarget;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uForceDash;
uniform float uHiddenDashM;
varying float vAlong;
varying vec3 vColor;
varying vec2 vDash;
#include <fog_pars_fragment>
void main() {
  vec2 dash = vDash;
  if (uForceDash > 0.5) dash = vec2(uHiddenDashM, uHiddenDashM * 0.8);
  if (dash.x > 0.0) {
    float per = dash.x + dash.y;
    if (mod(vAlong, per) > dash.x) discard;
  }
  gl_FragColor = vec4(vColor, uOpacity);
  #include <fog_fragment>
}`;

/** Bez danych o śniegu – grubość 0 (tekstura 1 × 1). */
const NO_SNOW: SnowUniforms = (() => {
  const t = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  t.needsUpdate = true;
  return { uDepthTex: { value: t }, uDepthGrid: { value: new THREE.Vector2(1, 1) }, uDepthCell: { value: 1 }, uSnowExag: { value: 0 }, uHasSnow: { value: 0 } };
})();

function makeMaterial(hidden: boolean, snowU: SnowUniforms): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uPxScale: { value: 0.001 },
        uLift: { value: 0.003 },
        uMppTarget: { value: 1 },
        uOpacity: { value: hidden ? 0.5 : 1 },
        uForceDash: { value: hidden ? 1 : 0 },
        uHiddenDashM: { value: 6 },
      },
    ]),
    fog: true,
    transparent: hidden,
    depthWrite: !hidden,
    side: THREE.DoubleSide,
  });
  // Uniformy śniegu wspólne z terenem (merge kopiuje – przypisane po utworzeniu).
  Object.assign(m.uniforms, snowU);
  if (hidden) m.depthFunc = THREE.GreaterDepth;
  return m;
}

/**
 * Zbiór linii jednej warstwy (np. „stałe”, „układ ośrodka”, „podglądy”) – jedna siatka, jedno
 * wywołanie rysowania (plus ewentualnie warstwa „za wzgórzem”).
 */
export class LineBatch {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly hiddenMat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  private hiddenMesh: THREE.Mesh | null = null;
  private pos: number[] = [];
  private dir: number[] = [];
  private side: number[] = [];
  private along: number[] = [];
  private half: number[] = [];
  private minPx: number[] = [];
  private col: number[] = [];
  private dash: number[] = [];
  private idx: number[] = [];
  /** Liczba wierzchołków ostatnio zbudowanej siatki (licznik). */
  vertexCount = 0;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    private readonly showHidden: boolean,
    private readonly renderOrder = 2,
    snowU: SnowUniforms = NO_SNOW,
  ) {
    this.mat = makeMaterial(false, snowU);
    this.hiddenMat = makeMaterial(true, snowU);
  }

  /** Uniformy wspólne dla klatki: skala pikseli, metry na piksel przy celu kamery. */
  setFrame(pxScale: number, mppTarget: number, fog: THREE.FogExp2 | null): void {
    for (const m of [this.mat, this.hiddenMat]) {
      m.uniforms.uPxScale.value = pxScale;
      m.uniforms.uMppTarget.value = mppTarget;
      m.uniforms.uHiddenDashM.value = Math.max(3, 7 * mppTarget);
      if (fog) {
        m.uniforms.fogColor.value.copy(fog.color);
        m.uniforms.fogDensity.value = fog.density;
      }
    }
  }

  clear(): void {
    this.pos = [];
    this.dir = [];
    this.side = [];
    this.along = [];
    this.half = [];
    this.minPx = [];
    this.col = [];
    this.dash = [];
    this.idx = [];
  }

  /** Linia po terenie (wstęga rozszerzana w shaderze). */
  addLine(pts: P2[], s: LineStyle, stepM = 6): void {
    if (pts.length < 2) return;
    const c = new THREE.Color(s.color);
    for (const piece of drapePolyline(pts, this.groundAt, stepM)) {
      const base = this.pos.length / 3;
      for (let i = 0; i < piece.length; i++) {
        const p = piece[i];
        const a = piece[Math.max(0, i - 1)];
        const b = piece[Math.min(piece.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        dx /= L;
        dz /= L;
        for (const sd of [-1, 1]) {
          this.pos.push(p.x, p.y, p.z);
          this.dir.push(dx, dz);
          this.side.push(sd);
          this.along.push(p.along);
          this.half.push(s.widthM / 2);
          this.minPx.push(s.minPx);
          this.col.push(c.r, c.g, c.b);
          this.dash.push(s.dashPx?.[0] ?? 0, s.dashPx?.[1] ?? 0);
        }
        if (i > 0) {
          const v = base + i * 2;
          this.idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
        }
      }
    }
  }

  /** Wielokąt wypełniony (np. parking) – wierzchołki na terenie. */
  addFill(poly: P2[], color: number): void {
    if (poly.length < 3) return;
    const c = new THREE.Color(color);
    const contour = poly.map((q) => new THREE.Vector2(q.xM, q.yM));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.pos.length / 3;
    for (const q of poly) {
      const y = this.groundAt(q.xM, q.yM);
      this.pos.push(q.xM, Number.isFinite(y) ? y : 0, q.yM);
      this.dir.push(1, 0);
      this.side.push(0);
      this.along.push(0);
      this.half.push(0);
      this.minPx.push(0);
      this.col.push(c.r, c.g, c.b);
      this.dash.push(0, 0);
    }
    for (const t of tris) this.idx.push(base + t[0], base + t[1], base + t[2]);
  }

  /** Okrąg na terenie (pierścień – np. zaznaczony budynek). */
  addRing(x: number, z: number, radiusM: number, s: LineStyle): void {
    const pts: P2[] = [];
    for (let k = 0; k <= 24; k++) pts.push({ xM: x + Math.cos((k / 24) * Math.PI * 2) * radiusM, yM: z + Math.sin((k / 24) * Math.PI * 2) * radiusM });
    this.addLine(pts, s, 50);
  }

  /** Zbudowanie siatki z dodanych linii. */
  commit(): void {
    for (const m of [this.mesh, this.hiddenMesh]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.mesh = null;
    this.hiddenMesh = null;
    this.vertexCount = this.pos.length / 3;
    if (!this.idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 2));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.side, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(this.along, 1));
    g.setAttribute('aHalfM', new THREE.Float32BufferAttribute(this.half, 1));
    g.setAttribute('aMinPx', new THREE.Float32BufferAttribute(this.minPx, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aDash', new THREE.Float32BufferAttribute(this.dash, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 50;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = this.renderOrder;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    if (this.showHidden) {
      this.hiddenMesh = new THREE.Mesh(g, this.hiddenMat);
      this.hiddenMesh.renderOrder = this.renderOrder + 10;
      this.hiddenMesh.frustumCulled = false;
      this.group.add(this.hiddenMesh);
    }
  }
}
