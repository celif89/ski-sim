/**
 * Etap 3D-0: bryły budynków – obrys (OSM albo budynek gracza) zamieniony na najmniejszy prostokąt
 * obejmujący (obracany), z którego powstaje bryła ze ścianami i dachem dwuspadowym (kalenica wzdłuż
 * dłuższego boku). Czyste funkcje (bez WebGL).
 */
import type { PointM } from '../sim/lifts';

export interface OrientedRect {
  cx: number;
  cy: number;
  /** Długość wzdłuż kalenicy i szerokość [m]. */
  lengthM: number;
  widthM: number;
  /** Kąt dłuższego boku (atan2 w płaszczyźnie mapy). */
  angle: number;
}

/** Otoczka wypukła (Andrew). */
export function convexHull(pts: PointM[]): PointM[] {
  const p = [...pts].sort((a, b) => a.xM - b.xM || a.yM - b.yM);
  if (p.length < 3) return p;
  const cross = (o: PointM, a: PointM, b: PointM) => (a.xM - o.xM) * (b.yM - o.yM) - (a.yM - o.yM) * (b.xM - o.xM);
  const lower: PointM[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: PointM[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Najmniejszy prostokąt obejmujący obrys (kierunki boków otoczki). */
export function minAreaRect(pts: PointM[]): OrientedRect {
  const h = convexHull(pts);
  if (h.length < 3) {
    const cx = pts.reduce((a, q) => a + q.xM, 0) / Math.max(1, pts.length);
    const cy = pts.reduce((a, q) => a + q.yM, 0) / Math.max(1, pts.length);
    return { cx, cy, lengthM: 6, widthM: 6, angle: 0 };
  }
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const ang = Math.atan2(b.yM - a.yM, b.xM - a.xM);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const q of h) {
      const u = q.xM * c + q.yM * s;
      const v = -q.xM * s + q.yM * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea) {
      bestArea = area;
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      const du = u1 - u0;
      const dv = v1 - v0;
      best = { cx: um * c - vm * s, cy: um * s + vm * c, lengthM: Math.max(du, dv), widthM: Math.min(du, dv), angle: du >= dv ? ang : ang + Math.PI / 2 };
    }
  }
  return best!;
}

/** Wysokość ścian z powierzchni zabudowy (większe budynki – wyższe), dach o nachyleniu ok. 40°. */
export function buildingHeights(r: OrientedRect): { wallM: number; ridgeM: number } {
  const area = r.lengthM * r.widthM;
  const wall = Math.max(3, Math.min(9, 2.6 + Math.sqrt(area) * 0.18));
  return { wallM: wall, ridgeM: (r.widthM / 2) * Math.tan((40 * Math.PI) / 180) };
}
