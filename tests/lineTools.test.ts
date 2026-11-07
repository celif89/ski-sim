/**
 * Etap 7c: upraszczanie linii narysowanej ręką i gładki łuk przez punkty kontrolne.
 * - trasa narysowana ręką z 300 próbek → najwyżej kilkanaście punktów kontrolnych,
 *   przebieg odbiega od narysowanego mniej niż tolerancja,
 * - odstęp punktów ≥ minPointSpacingM, gęściej tylko na wyraźnym zakręcie,
 * - łuk przechodzi przez punkty kontrolne, gładkość 0 = łamana.
 */
import { describe, expect, it } from 'vitest';

import uiJson from '../data/ui.json';
import { ctrlFromPoints, douglasPeucker, maxDeviation, parseLineParams, simplifyStroke, smoothPath, smoothPathWithSeg, turnAngleDeg } from '../src/render/lineTools';
import type { CtrlPt, Pt } from '../src/render/lineTools';

const lp = parseLineParams(uiJson);
const opts = { toleranceM: lp.toleranceM, minSpacingM: lp.minSpacingM, cornerAngleDeg: lp.cornerAngleDeg, smooth: lp.defaultSmooth };

/** Deterministyczny „szum ręki” (bez Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Trasa jak narysowana myszą: łuk w kształcie S, ok. 1,4 km, 300 próbek, drżenie ±1 m. */
function handDrawn(n = 300, seed = 7, wobbleM = 1): CtrlPt[] {
  const r = lcg(seed);
  const out: CtrlPt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = 1200 * t;
    const x = 180 * Math.sin(t * Math.PI * 2) + 60 * t;
    out.push({ xM: x + (r() - 0.5) * 2 * wobbleM, yM: y + (r() - 0.5) * 2 * wobbleM, widthM: 30 });
  }
  return out;
}

describe('Upraszczanie linii narysowanej ręką', () => {
  it('300 próbek → najwyżej kilkanaście punktów, odchyłka < tolerancja', () => {
    for (const seed of [1, 7, 42]) {
      const drawn = handDrawn(300, seed);
      const ctrl = simplifyStroke(drawn, opts);
      expect(ctrl.length).toBeGreaterThanOrEqual(3);
      expect(ctrl.length).toBeLessThanOrEqual(15);
      const curve = smoothPath(ctrl, opts.smooth, 1);
      expect(maxDeviation(curve, drawn)).toBeLessThan(lp.toleranceM);
      // Końce zostają dokładnie tam, gdzie zaczęto i skończono rysować.
      expect(ctrl[0]).toMatchObject({ xM: drawn[0].xM, yM: drawn[0].yM });
      expect(ctrl[ctrl.length - 1]).toMatchObject({ xM: drawn[299].xM, yM: drawn[299].yM });
    }
  });

  it('odstęp punktów co najmniej minPointSpacingM – gęściej tylko na wyraźnym zakręcie', () => {
    const drawn = handDrawn(300, 3);
    const ctrl = simplifyStroke(drawn, opts);
    for (let k = 1; k < ctrl.length - 1; k++) {
      const near = Math.min(Math.hypot(ctrl[k].xM - ctrl[k - 1].xM, ctrl[k].yM - ctrl[k - 1].yM), Math.hypot(ctrl[k + 1].xM - ctrl[k].xM, ctrl[k + 1].yM - ctrl[k].yM));
      if (near < lp.minSpacingM) expect(turnAngleDeg(ctrl[k - 1], ctrl[k], ctrl[k + 1])).toBeGreaterThanOrEqual(lp.cornerAngleDeg);
    }
  });

  it('drżenie ręki zmieniające się co próbkę (±1,5 m) – nadal najwyżej kilkanaście punktów', () => {
    const drawn: CtrlPt[] = Array.from({ length: 300 }, (_, i) => {
      const t = i / 299;
      return { xM: 650 * Math.sin(t * Math.PI * 1.6) + Math.sin(i * 7.3) * 1.5, yM: 1400 * t, widthM: 30 };
    });
    const ctrl = simplifyStroke(drawn, opts);
    expect(ctrl.length).toBeLessThanOrEqual(15);
    expect(maxDeviation(smoothPath(ctrl, opts.smooth, 1), drawn)).toBeLessThan(lp.toleranceM);
  });

  it('prosta linia z drżeniem → tylko dwa punkty', () => {
    const r = lcg(5);
    const drawn: Pt[] = Array.from({ length: 300 }, (_, i) => ({ xM: i * 3 + (r() - 0.5) * 2, yM: i * 1.5 + (r() - 0.5) * 2 }));
    expect(simplifyStroke(drawn, opts)).toHaveLength(2);
  });

  it('ostry zakręt (serpentyna) zostaje – punkt na zakręcie', () => {
    const drawn: Pt[] = [];
    for (let i = 0; i <= 100; i++) drawn.push({ xM: i * 4, yM: 0 });
    for (let i = 1; i <= 100; i++) drawn.push({ xM: 400 - i * 4, yM: i * 1.2 });
    const ctrl = simplifyStroke(drawn, opts);
    const curve = smoothPath(ctrl, opts.smooth, 1);
    expect(maxDeviation(curve, drawn)).toBeLessThan(lp.toleranceM);
    expect(ctrl.some((c) => Math.hypot(c.xM - 400, c.yM) < 15)).toBe(true);
  });
});

describe('Gładki łuk przez punkty kontrolne', () => {
  const ctrl: CtrlPt[] = [
    { xM: 0, yM: 0, widthM: 20 },
    { xM: 100, yM: 50, widthM: 40 },
    { xM: 200, yM: 0, widthM: 20 },
    { xM: 300, yM: 80, widthM: 30 },
  ];

  it('przechodzi przez każdy punkt kontrolny; szerokość liniowo', () => {
    const { points, seg } = smoothPathWithSeg(ctrl, 1, 5);
    for (const c of ctrl) expect(points.some((p) => Math.hypot(p.xM - c.xM, p.yM - c.yM) < 1e-9)).toBe(true);
    expect(points.every((p) => (p.widthM ?? 0) >= 20 && (p.widthM ?? 0) <= 40)).toBe(true);
    expect(seg[0]).toBe(0);
    expect(seg[seg.length - 1]).toBe(ctrl.length - 2);
    // Odstęp punktów krzywej nie większy niż krok (z zapasem na łuk).
    for (let i = 1; i < points.length; i++) expect(Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM)).toBeLessThan(5 * 1.6);
  });

  it('gładkość 0 – łamana (punkty na odcinkach)', () => {
    const pts = smoothPath(ctrl, 0, 5);
    expect(maxDeviation(pts, ctrl)).toBeLessThan(1e-6);
  });

  it('łuk nie robi pętli przy nierównych odstępach (wariant dośrodkowy)', () => {
    const uneven: Pt[] = [{ xM: 0, yM: 0 }, { xM: 5, yM: 2 }, { xM: 300, yM: 10 }, { xM: 305, yM: 0 }];
    const pts = smoothPath(uneven, 1, 2);
    expect(maxDeviation(pts, uneven)).toBeLessThan(20);
  });
});

describe('Pomocnicze', () => {
  it('Douglas–Peucker zachowuje końce i wierzchołek', () => {
    const pts: Pt[] = [{ xM: 0, yM: 0 }, { xM: 50, yM: 1 }, { xM: 100, yM: 0 }, { xM: 100, yM: 100 }];
    expect(douglasPeucker(pts, 4)).toEqual([0, 2, 3]);
  });

  it('starsza krótka łamana zostaje bez zmian (gładkość 0)', () => {
    const pts: CtrlPt[] = [{ xM: 0, yM: 0, widthM: 30 }, { xM: 100, yM: 300, widthM: 30 }, { xM: 50, yM: 600, widthM: 30 }];
    const r = ctrlFromPoints(pts, lp);
    expect(r.smooth).toBe(0);
    expect(r.ctrl).toEqual(pts);
  });
});
