/**
 * Etap 7f: przyciąganie i linie pomocnicze przy rysowaniu linii (wzór: Cities: Skylines).
 * Czyste funkcje (bez PixiJS) – liczy je kontroler budowy, rysuje SnapOverlay, sprawdzają testy.
 *
 * Kolejność (pierwsze trafienie wygrywa):
 *  1. punkty tej samej sieci (koniec rurociągu, hydrant, pompownia, armatka; koniec drogi, parking;
 *     stacja wyciągu, koniec trasy) w promieniu `radiusPx`;
 *  2. odcinki tej samej sieci (rzut na odcinek) w promieniu `radiusPx`;
 *  3. linie pomocnicze w promieniu `guideRadiusPx`: kąt względem sąsiedniego obiektu co `angleStepDeg`
 *     (w tym kąt prosty), przedłużenie istniejącego odcinka, równoległa do krawędzi trasy w stałej
 *     odległości (rurociąg, droga). Wygrywa najbliższa.
 * Shift wyłącza przyciąganie.
 */
import type { PointM } from '../sim/lifts';

export interface SnapParams {
  radiusPx: number;
  guideRadiusPx: number;
  angleStepDeg: number;
  /** Odległość równoległej od krawędzi trasy [m]. */
  parallelOffsetM: number;
  /** Najdalej, jak sięga przedłużenie odcinka [m]. */
  extendMaxM: number;
  /** Odniesienie do kąta: sąsiedni obiekt najdalej tyle od punktu startu [m]. */
  angleRefMaxM: number;
}

export function parseSnapParams(raw: unknown): SnapParams {
  const s = (raw as { snapping?: Record<string, { value: number }> }).snapping;
  if (!s) throw new Error('data/ui.json: brak sekcji snapping');
  const n = (k: string) => {
    const v = s[k]?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`data/ui.json: snapping.${k} – brak liczby`);
    return v;
  };
  return { radiusPx: n('radiusPx'), guideRadiusPx: n('guideRadiusPx'), angleStepDeg: n('angleStepDeg'), parallelOffsetM: n('parallelOffsetM'), extendMaxM: n('extendMaxM'), angleRefMaxM: n('angleRefMaxM') };
}

export interface SnapPoint {
  xM: number;
  yM: number;
  label: string;
}

export interface SnapSegment {
  a: PointM;
  b: PointM;
  label: string;
}

export interface SnapContext {
  /** Punkty tej samej sieci. */
  points: SnapPoint[];
  /** Odcinki tej samej sieci. */
  segments: SnapSegment[];
  /** Odcinki sąsiednich obiektów – odniesienie kąta i przedłużenia. */
  refs: SnapSegment[];
  /** Linie równoległe (już przesunięte o parallelOffsetM od krawędzi trasy). */
  parallels: SnapSegment[];
  /** Ostatni postawiony punkt rysowanej linii (linie pomocnicze kąta) – null przed pierwszym. */
  anchor: PointM | null;
  /** Kierunek poprzedniego odcinka rysowanej linii (odniesienie kąta, gdy brak sąsiada). */
  prevDir: PointM | null;
  metersPerPixel: number;
  shift: boolean;
}

export type GuideKind = 'angle' | 'extend' | 'parallel';

export interface SnapResult {
  point: PointM;
  /** Trafiony punkt lub odcinek sieci (znacznik na mapie). */
  hit: { kind: 'point' | 'segment'; label: string } | null;
  /** Linia pomocnicza (od – do, w metrach) z opisem, np. „90°”, „przedłużenie”, „równolegle 5 m”. */
  guide: { kind: GuideKind; from: PointM; to: PointM; label: string } | null;
}

function project(p: PointM, a: PointM, b: PointM): { q: PointM; t: number; d: number } {
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.xM - a.xM) * dx + (p.yM - a.yM) * dy) / L2)) : 0;
  const q = { xM: a.xM + t * dx, yM: a.yM + t * dy };
  return { q, t, d: Math.hypot(p.xM - q.xM, p.yM - q.yM) };
}

/** Kierunek najbliższego odcinka odniesienia (do punktu startu), znormalizowany; null – brak w zasięgu. */
export function referenceDirection(anchor: PointM, refs: SnapSegment[], maxM: number): { dir: PointM; label: string } | null {
  let best: { dir: PointM; label: string; d: number } | null = null;
  for (const r of refs) {
    const pr = project(anchor, r.a, r.b);
    if (pr.d > maxM || (best && pr.d >= best.d)) continue;
    const L = Math.hypot(r.b.xM - r.a.xM, r.b.yM - r.a.yM);
    if (L < 1e-6) continue;
    best = { dir: { xM: (r.b.xM - r.a.xM) / L, yM: (r.b.yM - r.a.yM) / L }, label: r.label, d: pr.d };
  }
  return best ? { dir: best.dir, label: best.label } : null;
}

/** Linia pomocnicza kąta: kierunek od punktu startu obrócony o wielokrotność kroku względem odniesienia. */
export function angleGuide(cursor: PointM, anchor: PointM, refDir: PointM, stepDeg: number): { point: PointM; angleDeg: number; distM: number } | null {
  const vx = cursor.xM - anchor.xM;
  const vy = cursor.yM - anchor.yM;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) return null;
  const ref = Math.atan2(refDir.yM, refDir.xM);
  const ang = Math.atan2(vy, vx) - ref;
  const step = (stepDeg * Math.PI) / 180;
  const k = Math.round(ang / step);
  const snapped = ref + k * step;
  const ux = Math.cos(snapped);
  const uy = Math.sin(snapped);
  const t = vx * ux + vy * uy;
  if (t <= 0) return null;
  const point = { xM: anchor.xM + ux * t, yM: anchor.yM + uy * t };
  let deg = (((k * stepDeg) % 360) + 360) % 360;
  if (deg > 180) deg = 360 - deg;
  return { point, angleDeg: Math.round(deg), distM: Math.hypot(cursor.xM - point.xM, cursor.yM - point.yM) };
}

export function snapPoint(cursor: PointM, ctx: SnapContext, p: SnapParams): SnapResult {
  if (ctx.shift) return { point: cursor, hit: null, guide: null };
  const r = p.radiusPx * ctx.metersPerPixel;
  // 1. punkty sieci
  let bp: SnapPoint | null = null;
  let bd = r;
  for (const q of ctx.points) {
    const d = Math.hypot(q.xM - cursor.xM, q.yM - cursor.yM);
    if (d <= bd) {
      bd = d;
      bp = q;
    }
  }
  if (bp) return { point: { xM: bp.xM, yM: bp.yM }, hit: { kind: 'point', label: bp.label }, guide: null };
  // 2. odcinki sieci
  let bs: { q: PointM; label: string } | null = null;
  bd = r;
  for (const s of ctx.segments) {
    const pr = project(cursor, s.a, s.b);
    if (pr.d <= bd) {
      bd = pr.d;
      bs = { q: pr.q, label: s.label };
    }
  }
  if (bs) return { point: bs.q, hit: { kind: 'segment', label: bs.label }, guide: null };
  // 3. linie pomocnicze
  const gr = p.guideRadiusPx * ctx.metersPerPixel;
  let guide: SnapResult['guide'] = null;
  let point = cursor;
  let gd = gr;
  if (ctx.anchor) {
    const ref = referenceDirection(ctx.anchor, ctx.refs, p.angleRefMaxM);
    const dir = ref?.dir ?? ctx.prevDir;
    if (dir) {
      const g = angleGuide(cursor, ctx.anchor, dir, p.angleStepDeg);
      if (g && g.distM <= gd) {
        gd = g.distM;
        point = g.point;
        guide = { kind: 'angle', from: ctx.anchor, to: g.point, label: `${g.angleDeg}°${ref ? ` do: ${ref.label}` : ''}` };
      }
    }
  }
  for (const s of ctx.refs) {
    // Przedłużenie za oba końce odcinka.
    for (const [a, b] of [
      [s.a, s.b],
      [s.b, s.a],
    ] as const) {
      const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
      if (L < 1e-6) continue;
      const ux = (b.xM - a.xM) / L;
      const uy = (b.yM - a.yM) / L;
      const t = (cursor.xM - b.xM) * ux + (cursor.yM - b.yM) * uy;
      if (t <= 0 || t > p.extendMaxM) continue;
      const q = { xM: b.xM + ux * t, yM: b.yM + uy * t };
      const d = Math.hypot(cursor.xM - q.xM, cursor.yM - q.yM);
      if (d < gd) {
        gd = d;
        point = q;
        guide = { kind: 'extend', from: b, to: q, label: `przedłużenie: ${s.label}` };
      }
    }
  }
  for (const s of ctx.parallels) {
    const pr = project(cursor, s.a, s.b);
    if (pr.d < gd) {
      gd = pr.d;
      point = pr.q;
      guide = { kind: 'parallel', from: s.a, to: s.b, label: `${s.label} (${p.parallelOffsetM} m od krawędzi)` };
    }
  }
  return { point, hit: null, guide };
}

/** Łuk: krzywa Béziera 2. stopnia od a przez punkt sterujący c do b, próbki co stepM (bez punktu a). */
export function arcPoints(a: PointM, c: PointM, b: PointM, stepM: number): PointM[] {
  const L = Math.hypot(c.xM - a.xM, c.yM - a.yM) + Math.hypot(b.xM - c.xM, b.yM - c.yM);
  const n = Math.max(2, Math.ceil(L / Math.max(0.5, stepM)));
  const out: PointM[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ xM: u * u * a.xM + 2 * u * t * c.xM + t * t * b.xM, yM: u * u * a.yM + 2 * u * t * c.yM + t * t * b.yM });
  }
  return out;
}

/** Odcinki łamanej (do kontekstu przyciągania). */
export function polylineSegments(pts: PointM[], label: string): SnapSegment[] {
  const out: SnapSegment[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], label });
  return out;
}
