/**
 * Etap 7c: rysowanie linii (trasy, drogi, rurociągi, trasy letnie).
 *  – linia narysowana ręką jest upraszczana do kilku punktów kontrolnych (w duchu Douglasa–Peuckera:
 *    zostają punkty, bez których przebieg odbiegałby od narysowanego bardziej niż tolerancja),
 *  – przez punkty kontrolne prowadzony jest gładki łuk (krzywa Catmulla–Roma, odmiana dośrodkowa –
 *    bez pętli i „przestrzeleń” przy nierównych odstępach); „gładkość” 0 = łamana, 1 = pełny łuk,
 *  – punkty leżą co najmniej co minPointSpacingM (30–50 m), gęściej tylko na wyraźnych zakrętach.
 * Parametry w data/ui.json (sekcja „lines”). Bez PixiJS i DOM – liczone też w testach.
 */
import { readNumber, readSection } from '../sim/params';

export interface Pt {
  xM: number;
  yM: number;
}

/** Punkt kontrolny z opcjonalną szerokością (trasy narciarskie). */
export type CtrlPt = Pt & { widthM?: number };

export interface LineParams {
  toleranceM: number;
  tolerancePx: number;
  minSpacingM: number;
  cornerAngleDeg: number;
  sampleStepM: number;
  defaultSmooth: number;
}

const FILE = 'data/ui.json';

export function parseLineParams(json: unknown): LineParams {
  const s = readSection(json as Record<string, unknown>, 'lines', FILE);
  return {
    toleranceM: readNumber(s, 'simplifyToleranceM', FILE, { min: 0.1 }),
    tolerancePx: readNumber(s, 'simplifyTolerancePx', FILE, { min: 0 }),
    minSpacingM: readNumber(s, 'minPointSpacingM', FILE, { min: 1 }),
    cornerAngleDeg: readNumber(s, 'cornerAngleDeg', FILE, { min: 1, max: 180 }),
    sampleStepM: readNumber(s, 'sampleStepM', FILE, { min: 0.5 }),
    defaultSmooth: readNumber(s, 'defaultSmoothness', FILE, { min: 0, max: 1 }),
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.xM - b.xM, a.yM - b.yM);

/** Odległość punktu od odcinka a–b i położenie rzutu (0–1). */
export function segmentDistance(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.xM - a.xM) * dx + (p.yM - a.yM) * dy) / l2)) : 0;
  return { d: Math.hypot(p.xM - (a.xM + t * dx), p.yM - (a.yM + t * dy)), t };
}

/** Najbliższe miejsce łamanej: indeks odcinka, położenie na nim i odległość. */
export function nearestOnPolyline(p: Pt, line: readonly Pt[]): { index: number; t: number; d: number } {
  let best = { index: 0, t: 0, d: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const r = segmentDistance(p, line[i], line[i + 1]);
    if (r.d < best.d) best = { index: i, t: r.t, d: r.d };
  }
  if (line.length === 1) best = { index: 0, t: 0, d: dist(p, line[0]) };
  return best;
}

/** Klasyczny Douglas–Peucker: indeksy punktów, które zostają (łamana w granicy tolerancji). */
export function douglasPeucker(points: readonly Pt[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wd = toleranceM;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]).d;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** Parametr węzła krzywej dośrodkowej (alfa 0,5). */
function knot(t: number, a: Pt, b: Pt): number {
  return t + Math.max(1e-6, Math.sqrt(dist(a, b)));
}

/** Punkt krzywej Catmulla–Roma (dośrodkowej) między p1 a p2 dla u ∈ [0, 1]. */
export function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const w = tb - ta > 1e-9 ? (t - ta) / (tb - ta) : 0;
    return { xM: a.xM + (b.xM - a.xM) * w, yM: a.yM + (b.yM - a.yM) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Gładki przebieg przez punkty kontrolne: punkty co ok. stepM, przechodzi dokładnie przez każdy punkt
 * kontrolny. smooth 0 – łamana, 1 – pełny łuk. Szerokość (jeśli jest) – liniowo między punktami.
 * seg[i] – numer odcinka kontrolnego, z którego pochodzi punkt i (do wstawiania punktów).
 */
export function smoothPathWithSeg<T extends CtrlPt>(ctrl: readonly T[], smooth: number, stepM: number): { points: T[]; seg: number[] } {
  const n = ctrl.length;
  if (n < 2) return { points: ctrl.map((c) => ({ ...c })), seg: ctrl.map(() => 0) };
  const s = Math.max(0, Math.min(1, smooth));
  const points: T[] = [];
  const seg: number[] = [];
  const phantom = (a: Pt, b: Pt): Pt => ({ xM: 2 * a.xM - b.xM, yM: 2 * a.yM - b.yM });
  for (let i = 0; i < n - 1; i++) {
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p0 = i > 0 ? ctrl[i - 1] : phantom(p1, p2);
    const p3 = i + 2 < n ? ctrl[i + 2] : phantom(p2, p1);
    const steps = Math.max(1, Math.ceil(dist(p1, p2) / stepM));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const lin = { xM: p1.xM + (p2.xM - p1.xM) * u, yM: p1.yM + (p2.yM - p1.yM) * u };
      const c = s > 0 ? catmullRom(p0, p1, p2, p3, u) : lin;
      const q = { ...p1, xM: lin.xM + (c.xM - lin.xM) * s, yM: lin.yM + (c.yM - lin.yM) * s } as T;
      if (p1.widthM !== undefined && p2.widthM !== undefined) (q as CtrlPt).widthM = p1.widthM + (p2.widthM - p1.widthM) * u;
      points.push(q);
      seg.push(i);
    }
  }
  points.push({ ...ctrl[n - 1] });
  seg.push(n - 2);
  return { points, seg };
}

export function smoothPath<T extends CtrlPt>(ctrl: readonly T[], smooth: number, stepM: number): T[] {
  return smoothPathWithSeg(ctrl, smooth, stepM).points;
}

/**
 * Największa odchyłka gładkiego przebiegu od linii narysowanej (w obie strony: próbki od przebiegu
 * i przebieg od próbek – łuk nie może też „uciec” poza narysowaną linię).
 */
export function maxDeviation(curve: readonly Pt[], drawn: readonly Pt[]): number {
  let m = 0;
  for (const p of drawn) m = Math.max(m, nearestOnPolyline(p, curve).d);
  for (const p of curve) m = Math.max(m, nearestOnPolyline(p, drawn).d);
  return m;
}

/** Kąt zmiany kierunku w punkcie b (0° – prosto, 180° – zawrócenie). */
export function turnAngleDeg(a: Pt, b: Pt, c: Pt): number {
  const ux = b.xM - a.xM;
  const uy = b.yM - a.yM;
  const vx = c.xM - b.xM;
  const vy = c.yM - b.yM;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) * 180) / Math.PI;
}

export interface SimplifyOptions {
  toleranceM: number;
  minSpacingM: number;
  cornerAngleDeg: number;
  smooth: number;
}

/**
 * Linia narysowana ręką → punkty kontrolne. Najpierw tylko końce; potem dokładamy próbkę, w której
 * gładki przebieg najbardziej odbiega od narysowanego (Douglas–Peucker liczony względem łuku zamiast
 * cięciwy), aż odchyłka spadnie poniżej tolerancji. Na koniec usuwamy punkty bliższe niż
 * minSpacingM, o ile przebieg zostaje w tolerancji (na wyraźnym zakręcie – zostają).
 */
export function simplifyStroke<T extends CtrlPt>(samples: readonly T[], o: SimplifyOptions): T[] {
  const pts = samples.filter((q, i) => i === 0 || dist(q, samples[i - 1]) > 0.01);
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const tol = o.toleranceM;
  const fine = Math.max(0.5, Math.min(2, tol / 2));
  let idx = [0, pts.length - 1];
  const curveOf = (ix: number[]) => smoothPath(ix.map((i) => pts[i]), o.smooth, fine);
  // Odchyłka liczona na zakresie próbek między kolejnymi punktami kontrolnymi.
  for (let iter = 0; iter < pts.length; iter++) {
    const curve = curveOf(idx);
    let worst = -1;
    let wd = tol * 0.85;
    for (let i = 1; i < pts.length - 1; i++) {
      if (idx.includes(i)) continue;
      const d = nearestOnPolyline(pts[i], curve).d;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst < 0) {
      // Łuk nie może też odejść od narysowanej linii (przestrzelenie między punktami).
      let far = -1;
      let fd = tol * 0.85;
      for (const c of curve) {
        const r = nearestOnPolyline(c, pts);
        if (r.d > fd) {
          fd = r.d;
          far = r.index + (r.t > 0.5 ? 1 : 0);
        }
      }
      if (far < 0 || idx.includes(far)) break;
      worst = far;
    }
    idx = [...idx, worst].sort((a, b) => a - b);
  }
  // Odstęp co najmniej minSpacingM – usuwamy najpierw punkty na najkrótszych odcinkach.
  const devOk = (ix: number[]) => maxDeviation(curveOf(ix), pts) <= tol;
  for (let guard = 0; guard < pts.length; guard++) {
    let cand = -1;
    let cl = Infinity;
    for (let k = 1; k < idx.length - 1; k++) {
      const a = pts[idx[k - 1]];
      const b = pts[idx[k]];
      const c = pts[idx[k + 1]];
      const near = Math.min(dist(a, b), dist(b, c));
      if (near >= o.minSpacingM) continue;
      if (turnAngleDeg(a, b, c) >= o.cornerAngleDeg) continue;
      if (near < cl) {
        cl = near;
        cand = k;
      }
    }
    if (cand < 0) break;
    const trial = idx.filter((_, k) => k !== cand);
    if (devOk(trial)) idx = trial;
    else {
      // Nie da się usunąć bez utraty dokładności – przesuwamy punkt na miejsce dalsze od sąsiada
      // (środek przedziału próbek) albo zostawiamy go.
      const lo = idx[cand - 1];
      const hi = idx[cand + 1];
      const mid = Math.round((lo + hi) / 2);
      const moved = idx.map((v, k) => (k === cand ? mid : v));
      if (mid !== idx[cand] && devOk(moved) && Math.min(dist(pts[lo], pts[mid]), dist(pts[mid], pts[hi])) > cl) idx = moved;
      else break;
    }
  }
  return idx.map((i) => ({ ...pts[i] }));
}

/** Tolerancja uproszczenia przy danym przybliżeniu (drżenie ręki rośnie z oddaleniem). */
export function effectiveTolerance(p: LineParams, metersPerPixel: number): number {
  return Math.max(p.toleranceM, p.tolerancePx * metersPerPixel);
}

/**
 * Punkty kontrolne dla obiektu zapisanego bez nich (starsze zapisy, prawdziwy ośrodek z OSM):
 * krótka łamana zostaje dokładnie jak była (gładkość 0), gęsta linia jest upraszczana.
 */
export function ctrlFromPoints<T extends CtrlPt>(points: readonly T[], p: LineParams): { ctrl: T[]; smooth: number } {
  if (points.length <= 12) return { ctrl: points.map((q) => ({ ...q })), smooth: 0 };
  return { ctrl: simplifyStroke(points, { toleranceM: p.toleranceM, minSpacingM: p.minSpacingM, cornerAngleDeg: p.cornerAngleDeg, smooth: p.defaultSmooth }), smooth: p.defaultSmooth };
}
