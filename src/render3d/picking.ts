/**
 * Etap 3D-1/3D-2: zamiana ekran ↔ teren w widoku 3D. Promień z kamery przez piksel ekranu, marsz
 * po terenie (krok zależny od wysokości nad terenem), a po przejściu pod teren – połowienie
 * przedziału do ułamka centymetra. Rzut punktu mapy: wysokość z tej samej funkcji terenu, więc
 * „punkt → ekran → punkt” wraca w to samo miejsce (test: ±0,5 m przy różnych kątach kamery,
 * także na stoku 40 %). `Camera3DAdapter` daje narzędziom ten sam interfejs co kamera mapy 2D.
 */
import * as THREE from 'three';
import type { ScreenPoint, ViewCamera, WorldPoint } from '../render/camera';

export type GroundFn = (x: number, z: number) => number;

/** Przecięcie promienia z terenem (null – brak trafienia w zasięgu). */
export function rayToTerrain(origin: THREE.Vector3, dir: THREE.Vector3, groundAt: GroundFn, maxM = 40000): THREE.Vector3 | null {
  let t0 = 0;
  let t = 0;
  for (let k = 0; k < 4000 && t < maxM; k++) {
    const y = origin.y + dir.y * t;
    const g = groundAt(origin.x + dir.x * t, origin.z + dir.z * t);
    if (Number.isFinite(g) && y <= g) {
      // Połowienie między ostatnim punktem nad terenem a pierwszym pod nim.
      let a = t0;
      let b = t;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        const gm = groundAt(origin.x + dir.x * m, origin.z + dir.z * m);
        if (Number.isFinite(gm) && origin.y + dir.y * m <= gm) b = m;
        else a = m;
        if (b - a < 1e-3) break;
      }
      const x = origin.x + dir.x * b;
      const z = origin.z + dir.z * b;
      return new THREE.Vector3(x, groundAt(x, z), z);
    }
    t0 = t;
    const h = Number.isFinite(g) ? y - g : 50;
    t += Math.min(60, Math.max(0.5, h * 0.4));
  }
  return null;
}

/** Promień z kamery przez piksel (współrzędne CSS względem lewego górnego rogu płótna). */
export function screenRay(camera: THREE.PerspectiveCamera, xPx: number, yPx: number, widthPx: number, heightPx: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
  const ndc = new THREE.Vector3((xPx / widthPx) * 2 - 1, -(yPx / heightPx) * 2 + 1, 0.5);
  const origin = camera.position.clone();
  const dir = ndc.unproject(camera).sub(origin).normalize();
  return { origin, dir };
}

export interface PickView {
  camera: THREE.PerspectiveCamera;
  widthPx: number;
  heightPx: number;
  groundAt: GroundFn;
  /** Cel kamery (środek obrotu) na mapie. */
  targetX: number;
  targetZ: number;
}

/**
 * Kamera 3D w roli kamery mapy dla narzędzi: piksel → punkt terenu (promień), punkt mapy → piksel
 * (rzut na wysokości terenu), metry na piksel przy kursorze.
 */
export class Camera3DAdapter implements ViewCamera {
  /** Kursor nad płótnem 3D – metry na piksel liczone w tym miejscu. */
  cursor: ScreenPoint | null = null;
  readonly rotated = false;

  constructor(
    private readonly view: () => PickView,
    private readonly onCenter: (xM: number, yM: number) => void,
  ) {}

  get centerXM(): number {
    return this.view().targetX;
  }

  get centerYM(): number {
    return this.view().targetZ;
  }

  get viewportWidthPx(): number {
    return this.view().widthPx;
  }

  get viewportHeightPx(): number {
    return this.view().heightPx;
  }

  get viewKey(): string {
    const c = this.view().camera;
    const e = c.matrixWorld.elements;
    return `${e[12].toFixed(2)}|${e[13].toFixed(2)}|${e[14].toFixed(2)}|${e[8].toFixed(4)}|${e[9].toFixed(4)}|${e[10].toFixed(4)}`;
  }

  get metersPerPixel(): number {
    const v = this.view();
    const at = this.cursor ? this.pick(this.cursor.xPx, this.cursor.yPx) : null;
    const d = at ? at.distanceTo(v.camera.position) : v.camera.position.distanceTo(new THREE.Vector3(v.targetX, v.groundAt(v.targetX, v.targetZ) || 0, v.targetZ));
    return (d * 2 * Math.tan((v.camera.fov * Math.PI) / 360)) / Math.max(1, v.heightPx);
  }

  /** Punkt terenu pod pikselem (null – niebo). */
  pick(xPx: number, yPx: number): THREE.Vector3 | null {
    const v = this.view();
    const r = screenRay(v.camera, xPx, yPx, v.widthPx, v.heightPx);
    return rayToTerrain(r.origin, r.dir, v.groundAt);
  }

  screenToWorld(xPx: number, yPx: number): WorldPoint {
    const p = this.pick(xPx, yPx);
    if (p) return { xM: p.x, yM: p.z };
    // Niebo – przecięcie z poziomem celu kamery (żeby narzędzia nie dostały NaN).
    const v = this.view();
    const r = screenRay(v.camera, xPx, yPx, v.widthPx, v.heightPx);
    const y0 = v.groundAt(v.targetX, v.targetZ) || 0;
    const t = r.dir.y < -1e-6 ? (y0 - r.origin.y) / r.dir.y : 1e5;
    return { xM: r.origin.x + r.dir.x * t, yM: r.origin.z + r.dir.z * t };
  }

  worldToScreen(xM: number, yM: number): ScreenPoint {
    const v = this.view();
    const g = v.groundAt(xM, yM);
    return this.project(xM, Number.isFinite(g) ? g : 0, yM);
  }

  /** Rzut punktu 3D (y – wysokość) na ekran; za kamerą – daleko poza ekranem. */
  project(x: number, y: number, z: number): ScreenPoint {
    const v = this.view();
    const p = new THREE.Vector3(x, y, z).applyMatrix4(v.camera.matrixWorldInverse);
    if (p.z > -1e-3) return { xPx: -1e6, yPx: -1e6 };
    p.applyMatrix4(v.camera.projectionMatrix);
    return { xPx: ((p.x + 1) / 2) * v.widthPx, yPx: ((1 - p.y) / 2) * v.heightPx };
  }

  centerOn(xM: number, yM: number): void {
    this.onCenter(xM, yM);
  }
}
