/**
 * Etap 3D-0: geometria wyciągów do widoku 3D – lina jako krzywa zwisu (ta sama co w lifts.ts:
 * cięciwa − 4·f·t(1−t)), krzesełka / orczyki w tych samych miejscach co w 2D i w symulacji gości:
 * (czas gry · prędkość) mod odstęp, w górę po prawej, w dół po lewej stronie osi.
 * Czyste funkcje (bez WebGL).
 */
import type { LiftAnalysis, LiftDesign, PointM } from '../sim/lifts';
import { cableElevationAt, carrierSpacingM, liftPath, pointAlongPath } from '../sim/lifts';

/** Rozstaw lin kolei (połowa) [m] – jak MoverLayer.ROPE_HALF_M w 2D. */
export const ROPE_HALF_M = 2;
/** Orczyk / talerzyk – lina z boku toru (połowa rozstawu) [m] – jak w 2D. */
export const SURFACE_HALF_M = 1.2;

export interface LiftFrame {
  path: PointM[];
  lengthM: number;
  point(d: number): PointM;
  /** Kierunek osi (kąt w płaszczyźnie mapy: atan2(dy, dx)) w odległości d. */
  dirAt(d: number): number;
  /** Wysokość liny n.p.m. w odległości poziomej d. */
  cableAt(d: number): number;
}

export function liftFrame(design: LiftDesign, an: LiftAnalysis, sagRatio: number): LiftFrame {
  const path = liftPath(design);
  const L = an.horizontalLengthM;
  const point = (d: number) => pointAlongPath(path, Math.max(0, Math.min(L, d)));
  const dirAt = (d: number) => {
    const p1 = point(d - 1);
    const p2 = point(d + 1);
    return Math.atan2(p2.yM - p1.yM, p2.xM - p1.xM);
  };
  const cableAt = (d: number) => cableElevationAt(an.supports, Math.max(0, Math.min(L, d)), sagRatio);
  return { path, lengthM: L, point, dirAt, cableAt };
}

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

/** Lina: dwie nitki (w górę i w dół) co stepM, z przesunięciem w bok o ±half. */
export function cableStrands(f: LiftFrame, half: number, stepM: number): Pt3[][] {
  const out: Pt3[][] = [[], []];
  const n = Math.max(2, Math.ceil(f.lengthM / stepM));
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * f.lengthM;
    const p = f.point(d);
    const h = f.dirAt(d);
    const y = f.cableAt(d);
    for (const [s, side] of [
      [0, 1],
      [1, -1],
    ] as const) {
      out[s].push({ x: p.xM - Math.sin(h) * half * side, y, z: p.yM + Math.cos(h) * half * side });
    }
  }
  return out;
}

export interface Carrier {
  x: number;
  y: number;
  z: number;
  /** Kierunek jazdy (kąt w płaszczyźnie mapy). */
  heading: number;
  /** 1 – w górę, −1 – w dół. */
  dir: 1 | -1;
}

/**
 * Krzesełka / orczyki w chwili timeS (s gry) – ta sama zasada co w 2D (propLayer) i w symulacji gości.
 * Odległość po linii (po skosie) przeliczana na poziomą przez wierzchołki łamanej (an.pathSlopeM).
 */
export function carrierPositions(design: LiftDesign, an: LiftAnalysis, f: LiftFrame, timeS: number): Carrier[] {
  const type = an.type;
  const spacing = carrierSpacingM(type);
  if (spacing <= 0 || design.closed) return [];
  const Ls = an.slopeLengthM || an.horizontalLengthM;
  const ps = an.pathSlopeM;
  const path = f.path;
  const vm = [0];
  for (let i = 1; i < path.length; i++) vm.push(vm[i - 1] + Math.hypot(path[i].xM - path[i - 1].xM, path[i].yM - path[i - 1].yM));
  const horiz = (dSlope: number) => {
    let i = 0;
    while (i < ps.length - 2 && ps[i + 1] < dSlope) i++;
    const fr = (dSlope - ps[i]) / (ps[i + 1] - ps[i] || 1);
    return vm[i] + Math.min(1, Math.max(0, fr)) * (vm[i + 1] - vm[i]);
  };
  const travel = (((timeS * type.speedMs) % spacing) + spacing) % spacing;
  const half = type.kind === 'aerial' ? ROPE_HALF_M : SURFACE_HALF_M;
  const out: Carrier[] = [];
  for (let d = travel; d < Ls; d += spacing) {
    for (const dir of [1, -1] as const) {
      const hd = horiz(dir === 1 ? d : Ls - d);
      const p = f.point(hd);
      const hh = f.dirAt(hd) + (dir === 1 ? 0 : Math.PI);
      out.push({ x: p.xM - Math.sin(hh) * half, z: p.yM + Math.cos(hh) * half, y: f.cableAt(hd), heading: hh, dir });
    }
  }
  return out;
}
